/**
 * riderController.js — Rider Mode: last-mile delivery actions
 *
 * Routes:
 *   GET  /rider                        — myJobs
 *   GET  /rider/job/:orderId           — jobDetail
 *   POST /rider/job/:orderId/accept    — acceptJob
 *   POST /rider/job/:orderId/pickup    — pickupJob
 *   POST /rider/job/:orderId/deliver   — deliverJob (GPS + photo + name)
 *   POST /rider/job/:orderId/fail      — failJob
 *   GET  /rider/history                — history
 *   GET  /rider/profile                — showProfile
 *   POST /rider/profile                — updateProfile
 *   POST /rider/status                 — toggleStatus (online/offline)
 */
import pool from '../config/db.js';
import { transitionOrder, withTransaction, WorkflowError } from '../services/orderWorkflowService.js';
import { kickNotificationWorker } from '../services/notificationService.js';
import { claimOffer } from '../services/riderDispatchService.js';
import { rememberDeliveryLocation } from '../services/receiverLocationService.js';

// ── Available (unclaimed) job offers for a rider ────────────────────────────────
async function getAvailableOffers(riderUserId) {
  const [offers] = await pool.query(
    `SELECT do.id, do.claim_code, do.expires_at,
            o.job_no, o.cod_amount, o.last_mile_fee,
            c.name AS receiver_name, c.address AS receiver_address
     FROM delivery_offer_recipients dor
     JOIN delivery_offers do ON do.id = dor.offer_id
     JOIN orders o ON o.id = do.order_id
     LEFT JOIN customers c ON c.id = o.receiver_id
     WHERE dor.rider_user_id = ?
       AND do.status = 'OPEN'
       AND (do.expires_at IS NULL OR do.expires_at > NOW())
       -- Belt and braces on top of the cancellation in transitionOrder: only
       -- these two statuses can still become RIDER_ASSIGNED, so anything else
       -- is a job that cannot be claimed and must not be offered. Listing one
       -- costs a rider a tap and an error they can do nothing about.
       AND o.status IN ('AT_DEST_WH', 'BRANCH_RECEIVED')
     ORDER BY do.created_at DESC`,
    [riderUserId]
  );
  return offers;
}

// ── Haversine distance (meters) ────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ── Log delivery event ─────────────────────────────────────────────────────────
async function logEvent(order_id, rider_id, event_type, note = '', lat = null, lng = null, photo_url = null, conn = pool) {
  await conn.query(
    'INSERT INTO delivery_events (order_id, rider_id, event_type, note, lat, lng, photo_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [order_id, rider_id, event_type, note, lat, lng, photo_url]
  );
}

// ── WhatsApp: แจ้งลูกค้าหลังส่งสำเร็จ ────────────────────────────────────────
// ── GET /rider — งานของฉัน ────────────────────────────────────────────────────
export async function myJobs(req, res) {
  try {
    const riderId = req.session.user.id;

    const [[riderRow]] = await pool.query('SELECT status FROM riders WHERE user_id=?', [riderId]);

    const [jobs] = await pool.query(`
      SELECT o.*,
        s.name  AS sender_name_r,  s.phone  AS sender_phone,
        r.name  AS receiver_name_r, r.phone AS receiver_phone,
        r.address AS receiver_address,
        o.receiver_lat AS dest_lat, o.receiver_lng AS dest_lng
      FROM orders o
      LEFT JOIN customers s ON o.sender_id   = s.id
      LEFT JOIN customers r ON o.receiver_id = r.id
      WHERE o.rider_id = ?
        AND o.status IN ('RIDER_ASSIGNED','RIDER_ACCEPTED','OUT_FOR_DELIVERY')
      ORDER BY o.assigned_at DESC
    `, [riderId]);

    const [[stat]] = await pool.query(`
      SELECT
        COUNT(*) AS cnt,
        COALESCE(SUM(cod_collected_amount), 0) AS cod_total
      FROM orders
      WHERE rider_id = ? AND status IN ('DELIVERED','COD_COLLECTED','COD_REMITTED','CLOSED')
        AND DATE(delivered_at) = CURDATE()
    `, [riderId]);

    const offers = await getAvailableOffers(riderId);

    res.render('rider/index', {
      title: 'งานของฉัน | SNG Rider',
      jobs,
      offers,
      pending:        jobs.length,
      todayDelivered: stat?.cnt      || 0,
      todayCOD:       stat?.cod_total || 0,
      riderStatus:    riderRow?.status || 'active',
      user:           req.session.user,
      layout:         'layouts/main',
    });
  } catch (e) {
    console.error('[Rider] myJobs:', e);
    res.status(500).send('เกิดข้อผิดพลาด');
  }
}

// ── GET /rider/offers — งานเปิดรับในสาขา (JSON สำหรับ auto-refresh) ──────────────
export async function availableOffersApi(req, res) {
  try {
    const offers = await getAvailableOffers(req.session.user.id);
    res.json({ success: true, offers });
  } catch (e) {
    console.error('[Rider] availableOffersApi:', e);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
}

// ── POST /rider/offers/:id/claim — กดรับงาน (ใครกดก่อนได้ก่อน) ───────────────────
export async function claimOfferHttp(req, res) {
  try {
    const result = await claimOffer(req.params.id, req.session.user.id, 'SYSTEM');
    if (result.won) {
      return res.json({ success: true, message: 'รับงานสำเร็จ! 🎉', orderId: result.orderId });
    }
    const CLAIM_REFUSALS = {
      EXPIRED:     'งานนี้หมดเวลาแล้ว',
      ORDER_MOVED: 'งานนี้ถูกจ่ายออกไปแล้ว ไม่ต้องกดรับ — สอบถามแอดมินได้',
      TAKEN:       'งานนี้ถูกไรเดอร์ท่านอื่นรับไปแล้ว',
    };
    const msg = CLAIM_REFUSALS[result.reason] || CLAIM_REFUSALS.TAKEN;
    return res.status(409).json({ success: false, message: msg, reason: result.reason });
  } catch (e) {
    console.error('[Rider] claimOfferHttp:', e);
    // WorkflowError messages are written for riders and are already in Thai;
    // anything else is an internal fault whose text (a SQL error, a state-machine
    // string) has no business on a rider's phone.
    const message = e instanceof WorkflowError ? e.message : 'รับงานไม่สำเร็จ กรุณาลองใหม่หรือแจ้งแอดมิน';
    res.status(e.statusCode || 500).json({ success: false, message });
  }
}

// ── GET /rider/job/:orderId ────────────────────────────────────────────────────
export async function jobDetail(req, res) {
  try {
    const riderId = req.session.user.id;
    const [rows] = await pool.query(`
      SELECT o.*,
        s.name  AS sender_name_r,  s.phone  AS sender_phone,
        r.name  AS receiver_name_r, r.phone AS receiver_phone,
        r.address AS receiver_address,
        o.receiver_lat AS dest_lat, o.receiver_lng AS dest_lng
      FROM orders o
      LEFT JOIN customers s ON o.sender_id   = s.id
      LEFT JOIN customers r ON o.receiver_id = r.id
      WHERE o.id = ? AND o.rider_id = ?
    `, [req.params.orderId, riderId]);

    if (!rows.length) return res.status(404).send('ไม่พบงาน');

    const [events] = await pool.query(
      'SELECT * FROM delivery_events WHERE order_id = ? ORDER BY created_at ASC',
      [req.params.orderId]
    );

    res.render('rider/job', {
      title: `งาน ${rows[0].job_no}`,
      order: rows[0],
      events,
      user:   req.session.user,
      layout: 'layouts/main',
    });
  } catch (e) {
    console.error('[Rider] jobDetail:', e);
    res.status(500).send('เกิดข้อผิดพลาด');
  }
}

// ── POST /rider/job/:orderId/accept ───────────────────────────────────────────
export async function acceptJob(req, res) {
  try {
    const riderId = req.session.user.id;
    const { orderId } = req.params;
    await withTransaction(async (conn) => {
      await transitionOrder({
        orderId,
        toStatus: 'RIDER_ACCEPTED',
        userId: riderId,
        note: 'Rider accepted delivery job',
        source: 'RIDER_ACCEPT',
        updates: { accepted_at: new Date() },
        connection: conn,
        validate: order => {
          if (String(order.rider_id) !== String(riderId)) throw new WorkflowError('Job is not assigned to this rider', 403);
        },
      });
      await logEvent(orderId, riderId, 'ACCEPTED', 'Rider accepted the job', null, null, null, conn);
    });
    kickNotificationWorker(orderId);
    res.json({ success: true, message: 'รับงานสำเร็จ' });
  } catch (e) {
    console.error('[Rider] acceptJob:', e);
    res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
}

// ── POST /rider/job/:orderId/pickup ───────────────────────────────────────────
export async function pickupJob(req, res) {
  try {
    const riderId = req.session.user.id;
    const { orderId } = req.params;
    const { lat, lng } = req.body;

    await withTransaction(async (conn) => {
      await transitionOrder({
        orderId,
        toStatus: 'OUT_FOR_DELIVERY',
        userId: riderId,
        note: 'Rider picked up parcel',
        source: 'RIDER_PICKUP',
        updates: { picked_up_at: new Date() },
        connection: conn,
        validate: order => {
          if (String(order.rider_id) !== String(riderId)) throw new WorkflowError('Job is not assigned to this rider', 403);
        },
      });
      await logEvent(orderId, riderId, 'PICKED_UP', 'Rider picked up parcel', lat || null, lng || null, null, conn);
      await conn.query(
        `UPDATE branch_deliveries bd JOIN riders r ON r.id=bd.rider_id
         SET bd.status='PICKED_UP', bd.picked_up_at=NOW()
         WHERE bd.order_id=? AND r.user_id=?`,
        [orderId, riderId]
      );
    });
    kickNotificationWorker(orderId);
    res.json({ success: true, message: 'รับสินค้าสำเร็จ กำลังออกส่ง' });
  } catch (e) {
    console.error('[Rider] pickupJob:', e);
    res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
}

// ── POST /rider/job/:orderId/deliver ──────────────────────────────────────────
export async function deliverJob(req, res) {
  try {
    const riderId = req.session.user.id;
    const { orderId } = req.params;
    const { recipient_name, lat, lng, accuracy, cod_collected } = req.body;

    // Validate required fields
    if (!recipient_name?.trim()) {
      return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อผู้รับ' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'กรุณาถ่ายรูปหลักฐาน' });
    }

    // Get order for WhatsApp + GPS check
    const [[order]] = await pool.query(
      'SELECT o.*, o.receiver_lat AS dest_lat, o.receiver_lng AS dest_lng FROM orders o WHERE o.id=? AND o.rider_id=?',
      [orderId, riderId]
    );
    if (!order) return res.status(404).json({ success: false, message: 'ไม่พบงาน' });

    if (order.status !== 'OUT_FOR_DELIVERY') {
      return res.status(409).json({ success: false, message: `Job is not out for delivery (${order.status})` });
    }

    const codCollected = Number(cod_collected || 0);
    if (!Number.isFinite(codCollected) || codCollected < 0) {
      return res.status(400).json({ success: false, message: 'Invalid COD amount' });
    }
    if (Number(order.cod_amount) > 0 && Math.abs(codCollected - Number(order.cod_amount)) > 0.01) {
      return res.status(400).json({ success: false, message: `COD must equal ${Number(order.cod_amount)}` });
    }

    // GPS distance
    const distM = haversine(parseFloat(lat), parseFloat(lng), parseFloat(order.dest_lat), parseFloat(order.dest_lng));
    const gpsVerified = distM !== null && distM <= 300;

    // Photo URL (use first file)
    const photoUrl = '/uploads/orders/' + req.files[0].filename;

    await withTransaction(async (conn) => {
      await transitionOrder({
        orderId,
        toStatus: 'DELIVERED',
        userId: riderId,
        note: `Delivered to ${recipient_name.trim()}`,
        source: 'RIDER_DELIVERED',
        updates: {
          recipient_name: recipient_name.trim(),
          pod_photo_url: photoUrl,
          delivery_lat: lat || null,
          delivery_lng: lng || null,
          delivery_accuracy: accuracy || null,
          delivery_distance_m: distM,
          gps_verified: gpsVerified ? 1 : 0,
          cod_collected_amount: codCollected,
          delivered_by: riderId,
        },
        connection: conn,
        validate: lockedOrder => {
          if (String(lockedOrder.rider_id) !== String(riderId)) throw new WorkflowError('Job is not assigned to this rider', 403);
        },
      });
      if (Number(order.cod_amount) > 0) {
        await conn.query(
          `INSERT INTO cod_settlements (order_id, cod_amount, status, collected_at)
           VALUES (?, ?, 'COLLECTED', NOW())
           ON DUPLICATE KEY UPDATE status='COLLECTED', collected_at=NOW(), cod_amount=VALUES(cod_amount)`,
          [orderId, order.cod_amount]
        );
        await transitionOrder({
          orderId,
          toStatus: 'COD_COLLECTED',
          userId: riderId,
          note: 'COD collected at delivery',
          source: 'RIDER_COD',
          connection: conn,
          notify: false,
        });
      }
      await logEvent(orderId, riderId, 'DELIVERED',
        `Delivered to ${recipient_name.trim()} | COD: ${codCollected} | GPS: ${distM ?? '?'}m`,
        lat || null, lng || null, photoUrl, conn);
      await conn.query(
        `UPDATE branch_deliveries bd JOIN riders r ON r.id=bd.rider_id
         SET bd.status='DELIVERED', bd.delivered_at=NOW(), bd.recipient_name=?, bd.proof_image=?
         WHERE bd.order_id=? AND r.user_id=?`,
        [recipient_name.trim(), photoUrl, orderId, riderId]
      );
      await conn.query(`UPDATE riders SET status='active' WHERE user_id=?`, [riderId]);
    });
    kickNotificationWorker(orderId);
    // The rider was standing at the receiver's door — the most accurate pin
    // this business will ever get for that address. Saving it means the next
    // parcel for the same person is routable without asking them for anything.
    // After the commit and never awaited into the response: a delivery that
    // physically happened must not fail over a bookkeeping write.
    rememberDeliveryLocation(orderId, lat, lng)
      .catch(err => console.error('[Rider] remember delivery location:', err.message));

    res.json({ success: true, message: `ส่งสำเร็จ! ${order.job_no}`, gpsVerified, distM });
  } catch (e) {
    console.error('[Rider] deliverJob:', e);
    res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
}

// ── POST /rider/job/:orderId/fail ─────────────────────────────────────────────
export async function failJob(req, res) {
  try {
    const riderId = req.session.user.id;
    const { orderId } = req.params;
    const { fail_reason, fail_note, lat, lng, next_attempt_date } = req.body;

    if (!fail_reason) {
      return res.status(400).json({ success: false, message: 'กรุณาเลือกเหตุผล' });
    }

    const photoUrl = req.files?.[0] ? '/uploads/orders/' + req.files[0].filename : null;

    await withTransaction(async (conn) => {
      await transitionOrder({
        orderId,
        toStatus: 'DELIVERY_FAILED',
        userId: riderId,
        note: `Delivery failed: ${fail_reason}`,
        source: 'RIDER_FAILED',
        updates: {
          fail_reason,
          fail_note: fail_note || '',
          next_attempt_date: next_attempt_date || null,
          delivery_lat: lat || null,
          delivery_lng: lng || null,
        },
        connection: conn,
        validate: order => {
          if (String(order.rider_id) !== String(riderId)) throw new WorkflowError('Job is not assigned to this rider', 403);
        },
      });
      await logEvent(orderId, riderId, 'FAILED',
        `Reason: ${fail_reason} | Note: ${fail_note || '-'}`,
        lat || null, lng || null, photoUrl, conn);
      await conn.query(
        `UPDATE branch_deliveries bd JOIN riders r ON r.id=bd.rider_id
         SET bd.status='FAILED', bd.notes=? WHERE bd.order_id=? AND r.user_id=?`,
        [fail_note || fail_reason, orderId, riderId]
      );
      await conn.query(`UPDATE riders SET status='active' WHERE user_id=?`, [riderId]);
    });
    kickNotificationWorker(orderId);

    res.json({ success: true, message: 'บันทึกส่งไม่สำเร็จแล้ว' });
  } catch (e) {
    console.error('[Rider] failJob:', e);
    res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
}

// ── GET /rider/history ────────────────────────────────────────────────────────
export async function history(req, res) {
  try {
    const riderId = req.session.user.id;
    const [jobs] = await pool.query(`
      SELECT o.*,
        r.name  AS receiver_name_r, r.phone AS receiver_phone
      FROM orders o
      LEFT JOIN customers r ON o.receiver_id = r.id
      WHERE o.rider_id = ?
        AND o.status IN ('DELIVERED','COD_COLLECTED','COD_REMITTED','CLOSED','DELIVERY_FAILED','RETURN_TO_SENDER')
      ORDER BY COALESCE(o.delivered_at, o.delivery_failed_at) DESC
      LIMIT 100
    `, [riderId]);

    res.render('rider/history', {
      title:  'ประวัติการส่ง | SNG Rider',
      jobs,
      user:   req.session.user,
      layout: 'layouts/main',
    });
  } catch (e) {
    console.error('[Rider] history:', e);
    res.status(500).send('เกิดข้อผิดพลาด');
  }
}

// ── GET /rider/profile — โปรไฟล์/ข้อมูลรถของตัวเอง ──────────────────────────────
export async function showProfile(req, res) {
  try {
    const [[rider]] = await pool.query(
      'SELECT id, name, phone, vehicle_type, vehicle_no, status FROM riders WHERE user_id=?',
      [req.session.user.id]
    );
    if (!rider) return res.status(404).send('ไม่พบบัญชีไรเดอร์');
    res.render('rider/profile', {
      title:  'โปรไฟล์ | SNG Rider',
      rider,
      user:   req.session.user,
      layout: 'layouts/main',
    });
  } catch (e) {
    console.error('[Rider] showProfile:', e);
    res.status(500).send('เกิดข้อผิดพลาด');
  }
}

// ── POST /rider/profile — แก้ชื่อ/เบอร์/ยานพาหนะของตัวเอง (ไม่รวมสาขา) ──────────────
export async function updateProfile(req, res) {
  try {
    const { name, phone, vehicle_type, vehicle_no } = req.body;
    if (!name?.trim() || !phone?.trim()) {
      req.session.flash = { type: 'error', message: 'ต้องระบุชื่อและเบอร์โทร' };
      return res.redirect('/rider/profile');
    }
    if (!['motorcycle', 'bicycle', 'car', 'tuk_tuk'].includes(vehicle_type)) {
      req.session.flash = { type: 'error', message: 'ประเภทยานพาหนะไม่ถูกต้อง' };
      return res.redirect('/rider/profile');
    }
    await pool.query(
      'UPDATE riders SET name=?, phone=?, vehicle_type=?, vehicle_no=? WHERE user_id=?',
      [name.trim(), phone.trim(), vehicle_type, vehicle_no?.trim() || null, req.session.user.id]
    );
    // Keep users.name in sync — it's what shows in headers/session everywhere else.
    await pool.query('UPDATE users SET name=? WHERE id=?', [name.trim(), req.session.user.id]);
    req.session.user.name = name.trim();
    req.session.flash = { type: 'success', message: 'บันทึกโปรไฟล์แล้ว' };
    res.redirect('/rider/profile');
  } catch (e) {
    console.error('[Rider] updateProfile:', e);
    req.session.flash = { type: 'error', message: e.message };
    res.redirect('/rider/profile');
  }
}

// ── POST /rider/status — สลับออนไลน์/ออฟไลน์ (พักงาน) ────────────────────────────
export async function toggleStatus(req, res) {
  try {
    const [[rider]] = await pool.query(
      'SELECT id, status FROM riders WHERE user_id=?', [req.session.user.id]
    );
    if (!rider) return res.status(404).json({ success: false, message: 'ไม่พบบัญชีไรเดอร์' });
    if (rider.status === 'busy') {
      return res.status(409).json({ success: false, message: 'กำลังส่งงานอยู่ ปิดออนไลน์ไม่ได้ตอนนี้' });
    }
    const next = rider.status === 'active' ? 'inactive' : 'active';
    await pool.query('UPDATE riders SET status=? WHERE id=?', [next, rider.id]);
    res.json({ success: true, status: next });
  } catch (e) {
    console.error('[Rider] toggleStatus:', e);
    res.status(500).json({ success: false, message: e.message });
  }
}
