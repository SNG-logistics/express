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
 */
import pool from '../config/db.js';

// ── Haversine distance (meters) ────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return null;
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
async function logEvent(order_id, rider_id, event_type, note = '', lat = null, lng = null, photo_url = null) {
  try {
    await pool.query(
      'INSERT INTO delivery_events (order_id, rider_id, event_type, note, lat, lng, photo_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [order_id, rider_id, event_type, note, lat, lng, photo_url]
    );
  } catch (e) {
    console.error('[Rider] logEvent error:', e.message);
  }
}

// ── WhatsApp: แจ้งลูกค้าหลังส่งสำเร็จ ────────────────────────────────────────
async function notifyDelivered(order) {
  try {
    const { sendWhatsApp } = await import('../services/whatsapp.js').catch(() => ({ sendWhatsApp: null }));
    if (!sendWhatsApp) return;
    const phone = order.receiver_phone || order.sender_phone;
    if (!phone) return;
    const msg =
      `✅ พัสดุของท่านถูกส่งถึงแล้ว\n` +
      `📦 เลขพัสดุ: ${order.job_no}\n` +
      `👤 รับโดย: ${order.recipient_name || 'ผู้รับ'}\n` +
      `🙏 ขอบคุณที่ใช้บริการ SNG Logistics`;
    await sendWhatsApp(phone, msg);
  } catch (e) {
    console.error('[Rider] WhatsApp notify error:', e.message);
  }
}

// ── GET /rider — งานของฉัน ────────────────────────────────────────────────────
export async function myJobs(req, res) {
  try {
    const riderId = req.session.user.id;

    const [jobs] = await pool.query(`
      SELECT o.*,
        s.name  AS sender_name_r,  s.phone  AS sender_phone,
        r.name  AS receiver_name_r, r.phone AS receiver_phone,
        r.address AS receiver_address,
        r.lat   AS dest_lat,       r.lng    AS dest_lng
      FROM orders o
      LEFT JOIN customers s ON o.sender_id   = s.id
      LEFT JOIN customers r ON o.receiver_id = r.id
      WHERE o.rider_id = ?
        AND o.status IN ('ASSIGNED_TO_RIDER','ACCEPTED_BY_RIDER','PICKED_UP_BY_RIDER','OUT_FOR_DELIVERY')
      ORDER BY o.assigned_at DESC
    `, [riderId]);

    const [[stat]] = await pool.query(`
      SELECT
        COUNT(*) AS cnt,
        COALESCE(SUM(cod_collected_amount), 0) AS cod_total
      FROM orders
      WHERE rider_id = ? AND status = 'DELIVERED'
        AND DATE(delivered_at) = CURDATE()
    `, [riderId]);

    res.render('rider/index', {
      title: 'งานของฉัน | SNG Rider',
      jobs,
      pending:        jobs.length,
      todayDelivered: stat?.cnt      || 0,
      todayCOD:       stat?.cod_total || 0,
      user:           req.session.user,
      layout:         'layouts/main',
    });
  } catch (e) {
    console.error('[Rider] myJobs:', e);
    res.status(500).send('เกิดข้อผิดพลาด');
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
        r.lat   AS dest_lat,       r.lng    AS dest_lng
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
    const [result] = await pool.query(
      `UPDATE orders SET status='ACCEPTED_BY_RIDER', accepted_at=NOW()
       WHERE id=? AND rider_id=? AND status='ASSIGNED_TO_RIDER'`,
      [orderId, riderId]
    );
    if (!result.affectedRows) {
      return res.status(400).json({ success: false, message: 'ไม่สามารถรับงานได้ (สถานะไม่ถูกต้อง)' });
    }
    await logEvent(orderId, riderId, 'ACCEPTED', 'ไรเดอร์รับงานแล้ว');
    res.json({ success: true, message: 'รับงานสำเร็จ' });
  } catch (e) {
    console.error('[Rider] acceptJob:', e);
    res.status(500).json({ success: false, message: e.message });
  }
}

// ── POST /rider/job/:orderId/pickup ───────────────────────────────────────────
export async function pickupJob(req, res) {
  try {
    const riderId = req.session.user.id;
    const { orderId } = req.params;
    const { lat, lng } = req.body;

    await pool.query(
      `UPDATE orders SET
         status='OUT_FOR_DELIVERY',
         picked_up_at=NOW(),
         out_for_delivery_at=NOW()
       WHERE id=? AND rider_id=?
         AND status IN ('ACCEPTED_BY_RIDER','ASSIGNED_TO_RIDER')`,
      [orderId, riderId]
    );
    await logEvent(orderId, riderId, 'PICKED_UP', 'รับสินค้าออกจากคลังแล้ว', lat || null, lng || null);
    res.json({ success: true, message: 'รับสินค้าสำเร็จ กำลังออกส่ง' });
  } catch (e) {
    console.error('[Rider] pickupJob:', e);
    res.status(500).json({ success: false, message: e.message });
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
      'SELECT o.*, r.lat AS dest_lat, r.lng AS dest_lng FROM orders o LEFT JOIN customers r ON o.receiver_id=r.id WHERE o.id=? AND o.rider_id=?',
      [orderId, riderId]
    );
    if (!order) return res.status(404).json({ success: false, message: 'ไม่พบงาน' });

    // GPS distance
    const distM = haversine(parseFloat(lat), parseFloat(lng), parseFloat(order.dest_lat), parseFloat(order.dest_lng));
    const gpsVerified = distM !== null && distM <= 300;

    // Photo URL (use first file)
    const photoUrl = '/uploads/' + req.files[0].filename;

    await pool.query(`
      UPDATE orders SET
        status                = 'DELIVERED',
        delivered_at          = NOW(),
        recipient_name        = ?,
        pod_photo_url         = ?,
        delivery_lat          = ?,
        delivery_lng          = ?,
        delivery_accuracy     = ?,
        delivery_distance_m   = ?,
        gps_verified          = ?,
        cod_collected_amount  = ?
      WHERE id = ? AND rider_id = ?
    `, [
      recipient_name.trim(),
      photoUrl,
      lat    || null,
      lng    || null,
      accuracy || null,
      distM,
      gpsVerified ? 1 : 0,
      parseFloat(cod_collected) || 0,
      orderId, riderId,
    ]);

    await logEvent(orderId, riderId, 'DELIVERED',
      `ส่งถึง: ${recipient_name} | COD: ${cod_collected || 0} | GPS: ${distM ?? '?'}m`,
      lat || null, lng || null, photoUrl
    );

    // Notify via WhatsApp
    order.recipient_name = recipient_name;
    await notifyDelivered(order);

    res.json({ success: true, message: `ส่งสำเร็จ! ${order.job_no}`, gpsVerified, distM });
  } catch (e) {
    console.error('[Rider] deliverJob:', e);
    res.status(500).json({ success: false, message: e.message });
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

    const photoUrl = req.files?.[0] ? '/uploads/' + req.files[0].filename : null;

    await pool.query(`
      UPDATE orders SET
        status              = 'DELIVERY_FAILED',
        delivery_failed_at  = NOW(),
        fail_reason         = ?,
        fail_note           = ?,
        next_attempt_date   = ?,
        delivery_lat        = ?,
        delivery_lng        = ?
      WHERE id = ? AND rider_id = ?
    `, [fail_reason, fail_note || '', next_attempt_date || null, lat || null, lng || null, orderId, riderId]);

    await logEvent(orderId, riderId, 'FAILED',
      `เหตุผล: ${fail_reason} | หมายเหตุ: ${fail_note || '-'}`,
      lat || null, lng || null, photoUrl
    );

    res.json({ success: true, message: 'บันทึกส่งไม่สำเร็จแล้ว' });
  } catch (e) {
    console.error('[Rider] failJob:', e);
    res.status(500).json({ success: false, message: e.message });
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
        AND o.status IN ('DELIVERED','DELIVERY_FAILED','RETURN_TO_BRANCH')
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
