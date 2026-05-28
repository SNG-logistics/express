/**
 * src/controllers/scannerController.js — v2
 *
 * Warehouse Receive & Scan Workflow
 */

import pool from '../config/db.js';
import { SCANNER_ALLOWED_STATUSES } from '../constants/statuses.js';
import { canTransitionOrder } from '../constants/transitions.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function logStatus(orderId, fromStatus, toStatus, note, userId) {
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, ?, ?)`,
    [orderId, fromStatus || null, toStatus, note || null, userId || null]
  );
}

async function getOrderFull(value, byId = false) {
  const field = byId ? 'o.id' : 'o.job_no';
  const [[order]] = await pool.query(
    `SELECT o.*,
            s.name AS sender_name, s.phone AS sender_phone,
            r.name AS receiver_name, r.phone AS receiver_phone,
            t.trip_no, t.status AS trip_status
     FROM orders o
     LEFT JOIN customers s ON s.id = o.sender_id
     LEFT JOIN customers r ON r.id = o.receiver_id
     LEFT JOIN trips t ON t.id = o.trip_id
     WHERE ${field} = ?`,
    [byId ? Number(value) : String(value).trim()]
  );
  return order || null;
}

// ─── GET /scanner — Hub ───────────────────────────────────────────────────────
export async function showScanner(req, res) {
  try {
    const [recentScans] = await pool.query(
      `SELECT o.id, o.job_no, o.status, o.updated_at,
              s.name AS sender_name, r.name AS receiver_name
       FROM orders o
       LEFT JOIN customers s ON o.sender_id = s.id
       LEFT JOIN customers r ON o.receiver_id = r.id
       ORDER BY o.updated_at DESC
       LIMIT 10`
    );
    const [[exStats]] = await pool.query(
      `SELECT COUNT(*) AS total FROM order_status_logs
       WHERE DATE(action_at) = CURDATE() AND note LIKE '%[EXCEPTION]%'`
    );
    res.render('scanner/index', {
      user: req.session.user,
      title: 'ศูนย์สแกน',
      recentScans,
      todayExceptions: exStats?.total || 0,
    });
  } catch (error) {
    console.error('[Scanner] showScanner error:', error);
    res.status(500).render('errors/500', { user: req.session.user, title: 'Error' });
  }
}

// ─── GET /scanner/quick — Quick scan (existing orders/scan.ejs) ───────────────
export async function showQuickScan(req, res) {
  try {
    const [recentScans] = await pool.query(
      `SELECT o.id, o.job_no, o.status, o.updated_at,
              s.name AS sender_name, r.name AS receiver_name
       FROM orders o
       LEFT JOIN customers s ON o.sender_id = s.id
       LEFT JOIN customers r ON o.receiver_id = r.id
       ORDER BY o.updated_at DESC
       LIMIT 10`
    );
    res.render('orders/scan', {
      user: req.session.user,
      title: 'สแกนด่วน',
      recentScans,
    });
  } catch (error) {
    console.error('[Scanner] showQuickScan error:', error);
    res.status(500).render('errors/500', { user: req.session.user, title: 'Error' });
  }
}

// ─── GET /scanner/receive — Batch receive screen ───────────────────────────────
export async function showReceive(req, res) {
  try {
    const [pending] = await pool.query(
      `SELECT o.id, o.job_no, o.direction, o.status, o.created_at,
              o.declared_weight, o.cod_amount, o.service_type,
              s.name AS sender_name, r.name AS receiver_name
       FROM orders o
       LEFT JOIN customers s ON s.id = o.sender_id
       LEFT JOIN customers r ON r.id = o.receiver_id
       WHERE o.status = 'NEW'
       ORDER BY o.created_at ASC
       LIMIT 50`
    );
    res.render('scanner/receive', {
      user: req.session.user,
      title: 'รับพัสดุเข้าคลัง',
      pendingOrders: pending,
    });
  } catch (error) {
    console.error('[Scanner] showReceive error:', error);
    res.status(500).render('errors/500', { user: req.session.user, title: 'Error' });
  }
}

// ─── GET /scanner/handoff/:tripId ─────────────────────────────────────────────
export async function showHandoff(req, res) {
  try {
    const { tripId } = req.params;
    const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [tripId]);
    if (!trip) {
      req.session.flash = { type: 'error', message: 'ไม่พบรอบรถ' };
      return res.redirect('/scanner');
    }
    const [tripOrders] = await pool.query(
      `SELECT o.id, o.job_no, o.status, o.direction,
              o.declared_weight, o.cod_amount, o.requires_customs,
              s.name AS sender_name, r.name AS receiver_name
       FROM trip_orders to2
       JOIN orders o ON o.id = to2.order_id
       LEFT JOIN customers s ON s.id = o.sender_id
       LEFT JOIN customers r ON r.id = o.receiver_id
       WHERE to2.trip_id = ?
       ORDER BY o.job_no ASC`,
      [tripId]
    );
    const confirmed   = tripOrders.filter(o => o.status === 'ON_TRUCK').length;
    const total       = tripOrders.length;
    res.render('scanner/handoff', {
      user: req.session.user,
      title: `Handoff: ${trip.trip_no}`,
      trip,
      tripOrders,
      confirmed,
      total,
      allConfirmed: confirmed === total && total > 0,
    });
  } catch (error) {
    console.error('[Scanner] showHandoff error:', error);
    res.status(500).render('errors/500', { user: req.session.user, title: 'Error' });
  }
}

// ─── POST /scanner/scan — AJAX lookup ─────────────────────────────────────────
export async function processScan(req, res) {
  try {
    const { barcode } = req.body;
    if (!barcode || !barcode.trim()) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุเลข Job No.' });
    }
    const order = await getOrderFull(barcode.trim());
    if (!order) {
      return res.status(404).json({ success: false, message: `ไม่พบพัสดุ: "${barcode.trim()}"` });
    }
    res.json({ success: true, order });
  } catch (error) {
    console.error('[Scanner] processScan error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการค้นหา' });
  }
}

// ─── POST /scanner/receive/:id — Receive parcel with condition ─────────────────
export async function receiveParcel(req, res) {
  try {
    const { id } = req.params;
    const { condition = 'OK', note = '', weight_actual } = req.body;
    const userId   = req.session.user?.id;
    const userRole = req.session.user?.role || '';

    // Handle files (intake_photos)
    const photoUrls = req.files ? req.files.map(f => `/uploads/orders/${f.filename}`) : [];

    const order = await getOrderFull(id, true);
    if (!order) return res.status(404).json({ success: false, message: 'ไม่พบออเดอร์' });
    if (order.status !== 'NEW') {
      return res.status(400).json({ success: false, message: `รับเข้าคลังไปแล้ว (${order.status})` });
    }

    const isMgr = ['admin','manager'].includes(userRole);
    let toStatus = null;
    if (order.direction === 'TH_TO_LA') {
      if (isMgr || ['dispatcher','warehouse_th'].includes(userRole)) toStatus = 'RECEIVED_WH_TH';
    } else {
      if (isMgr || ['dispatcher','warehouse_la'].includes(userRole)) toStatus = 'RECEIVED_WH_LA';
    }
    if (!toStatus) return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์รับพัสดุทิศทางนี้' });

    const condLabel = condition === 'DAMAGED' ? '[DAMAGED]' : condition === 'PARTIAL' ? '[PARTIAL]' : '';
    const photoLabel = photoUrls.length > 0 ? `[แนบรูป ${photoUrls.length} รูป]` : '';
    const auditNote = ['รับเข้าคลัง', condLabel, photoLabel, weight_actual ? `น้ำหนักจริง: ${weight_actual} กก.` : '', note ? `หมายเหตุ: ${note}` : ''].filter(Boolean).join(' — ');

    const setCols = ['status = ?', 'updated_at = NOW()'];
    const setVals = [toStatus];
    
    if (weight_actual) { setCols.push('actual_weight = ?'); setVals.push(Number(weight_actual)); }
    if (photoUrls.length > 0) {
      setCols.push('intake_photos = ?');
      setVals.push(JSON.stringify(photoUrls));
    }
    
    setVals.push(id);

    await pool.query(`UPDATE orders SET ${setCols.join(', ')} WHERE id = ?`, setVals);
    await logStatus(id, order.status, toStatus, auditNote, userId);
    if (condition === 'DAMAGED') {
      await logStatus(id, toStatus, toStatus, `[EXCEPTION] สภาพพัสดุ: เสียหาย — ${note || 'ไม่ระบุ'}`, userId);
    }

    res.json({ success: true, message: `รับเข้าคลังสำเร็จ${condLabel ? ' (' + condition + ')' : ''}`, newStatus: toStatus, jobNo: order.job_no });
  } catch (error) {
    console.error('[Scanner] receiveParcel error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
}

// ─── POST /scanner/exception/:id — Log exception ──────────────────────────────
export async function logException(req, res) {
  try {
    const { id } = req.params;
    const { type, description } = req.body;
    const userId = req.session.user?.id;

    const ALLOWED = new Set(['DAMAGED','MISSING','PARTIAL','TAMPERED','WRONG_ITEM','OTHER']);
    if (!ALLOWED.has(type)) return res.status(400).json({ success: false, message: 'ประเภท Exception ไม่ถูกต้อง' });

    const [[order]] = await pool.query('SELECT id, status, job_no FROM orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ success: false, message: 'ไม่พบออเดอร์' });

    await pool.query(
      `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
       VALUES (?, ?, ?, ?, ?)`,
      [id, order.status, order.status, `[EXCEPTION] ${type}: ${description || '–'}`, userId || null]
    );
    res.json({ success: true, message: `บันทึก Exception (${type}) สำเร็จ`, jobNo: order.job_no });
  } catch (error) {
    console.error('[Scanner] logException error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
}

// ─── POST /scanner/handoff/:tripId/confirm/:orderId ───────────────────────────
export async function confirmHandoff(req, res) {
  try {
    const { tripId, orderId } = req.params;
    const userId = req.session.user?.id;

    const [[order]] = await pool.query('SELECT id, status, job_no, trip_id FROM orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ success: false, message: 'ไม่พบออเดอร์' });
    if (String(order.trip_id) !== String(tripId)) return res.status(400).json({ success: false, message: 'ออเดอร์ไม่ได้อยู่ในรอบรถนี้' });
    if (order.status === 'ON_TRUCK') return res.json({ success: true, message: 'ยืนยันแล้ว', alreadyDone: true });
    if (!canTransitionOrder(order.status, 'ON_TRUCK')) {
      return res.status(400).json({ success: false, message: `ไม่สามารถยืนยัน Handoff จากสถานะ "${order.status}"` });
    }

    await pool.query('UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?', ['ON_TRUCK', orderId]);
    await logStatus(orderId, order.status, 'ON_TRUCK', `[HANDOFF] ยืนยันขึ้นรถ trip_id:${tripId}`, userId);

    res.json({ success: true, message: `ยืนยัน ${order.job_no} ขึ้นรถสำเร็จ`, jobNo: order.job_no });
  } catch (error) {
    console.error('[Scanner] confirmHandoff error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
}

// ─── GET /scanner/unload/:tripId ─────────────────────────────────────────────
export async function showUnload(req, res) {
  try {
    const { tripId } = req.params;
    const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [tripId]);
    if (!trip) {
      req.session.flash = { type: 'error', message: 'ไม่พบรอบรถ' };
      return res.redirect('/scanner');
    }
    const [tripOrders] = await pool.query(
      `SELECT o.id, o.job_no, o.status, o.direction,
              o.declared_weight, o.cod_amount, o.requires_customs,
              s.name AS sender_name, r.name AS receiver_name
       FROM trip_orders to2
       JOIN orders o ON o.id = to2.order_id
       LEFT JOIN customers s ON s.id = o.sender_id
       LEFT JOIN customers r ON r.id = o.receiver_id
       WHERE to2.trip_id = ?
       ORDER BY o.job_no ASC`,
      [tripId]
    );
    const confirmed   = tripOrders.filter(o => o.status === 'AT_DEST_WH').length;
    const total       = tripOrders.length;
    res.render('scanner/unload', {
      user: req.session.user,
      title: `รับลงคลัง: ${trip.trip_no}`,
      trip,
      tripOrders,
      confirmed,
      total,
      allConfirmed: confirmed === total && total > 0,
    });
  } catch (error) {
    console.error('[Scanner] showUnload error:', error);
    res.status(500).render('errors/500', { user: req.session.user, title: 'Error' });
  }
}

// ─── POST /scanner/unload/:tripId/confirm/:orderId ───────────────────────────
export async function confirmUnload(req, res) {
  try {
    const { tripId, orderId } = req.params;
    const userId = req.session.user?.id;

    const [[order]] = await pool.query('SELECT id, status, job_no, trip_id FROM orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ success: false, message: 'ไม่พบออเดอร์' });
    if (String(order.trip_id) !== String(tripId)) return res.status(400).json({ success: false, message: 'ออเดอร์ไม่ได้อยู่ในรอบรถนี้' });
    if (order.status === 'AT_DEST_WH') return res.json({ success: true, message: 'รับลงคลังแล้ว', alreadyDone: true });
    
    // We let them unload as long as it isn't AT_DEST_WH
    await pool.query('UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?', ['AT_DEST_WH', orderId]);
    await logStatus(orderId, order.status, 'AT_DEST_WH', `[UNLOAD] รับลงคลังสำเร็จ trip_id:${tripId}`, userId);
    
    // Record when it was unloaded
    await pool.query('UPDATE trip_orders SET unloaded_at = NOW() WHERE trip_id = ? AND order_id = ?', [tripId, orderId]);

    res.json({ success: true, message: `รับลงคลัง ${order.job_no} สำเร็จ`, jobNo: order.job_no });
  } catch (error) {
    console.error('[Scanner] confirmUnload error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
}

// ─── POST /scanner/update/:id — Quick status update ───────────────────────────
export async function quickStatusUpdate(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.session.user?.id;

    if (!status || !SCANNER_ALLOWED_STATUSES.has(status)) {
      return res.status(400).json({ success: false, message: `สถานะ "${status}" ไม่ถูกต้องหรือไม่ได้รับอนุญาต` });
    }
    const [[order]] = await pool.query('SELECT id, status FROM orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ success: false, message: 'ไม่พบออเดอร์' });
    if (!canTransitionOrder(order.status, status)) {
      return res.status(400).json({ success: false, message: `ไม่สามารถเปลี่ยนจาก "${order.status}" → "${status}" ได้` });
    }

    await pool.query('UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?', [status, id]);
    await pool.query(
      `INSERT INTO order_status_logs (order_id, from_status, to_status, action_by, action_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [id, order.status, status, userId || null]
    );
    res.json({ success: true, message: 'อัพเดทสถานะสำเร็จ' });
  } catch (error) {
    console.error('[Scanner] quickStatusUpdate error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการอัปเดตสถานะ' });
  }
}

// ─── GET /scanner/session — Today's scan summary ───────────────────────────────
export async function sessionSummary(req, res) {
  try {
    const userId = req.session.user?.id;
    const [logs] = await pool.query(
      `SELECT osl.order_id, osl.to_status AS status, osl.action_at AS updated_at, osl.note,
              o.job_no
       FROM order_status_logs osl
       JOIN orders o ON o.id = osl.order_id
       WHERE DATE(osl.action_at) = CURDATE() AND osl.action_by = ?
       ORDER BY osl.action_at DESC
       LIMIT 50`,
      [userId]
    );
    const exceptions    = logs.filter(l => (l.note || '').includes('[EXCEPTION]')).length;
    const todayScanned  = logs.filter(l => !((l.note||'').includes('[EXCEPTION]'))).length;
    res.json({
      success: true,
      recent: logs,
      todayScanned,
      todayExceptions: exceptions,
      stats: { total: logs.length, exceptions }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
}

// ─── GET /scanner/pda — PDA Mode (Gprinter IT68) ─────────────────────────────
export async function showPda(req, res) {
  try {
    const [trips] = await pool.query(
      `SELECT id, trip_no, driver_name
       FROM trips
       WHERE status IN ('PLANNED','IN_TRANSIT')
       ORDER BY created_at DESC LIMIT 20`
    );
    res.render('scanner/pda', {
      user:  req.session.user,
      title: 'PDA Scanner — SNG',
      trips,
    });
  } catch (error) {
    console.error('[Scanner] showPda error:', error);
    res.status(500).render('errors/500', { user: req.session.user, title: 'Error' });
  }
}

// ─── GET /scanner/screening — Screening Queue ─────────────────────────────────
export async function showScreening(req, res) {
  try {
    const [queue] = await pool.query(
      `SELECT o.id, o.job_no, o.direction, o.status, o.created_at, o.updated_at,
              o.declared_weight, o.actual_weight, o.declared_size,
              o.cod_amount, o.service_type, o.requires_customs,
              o.source_type, o.is_fragile, o.item_count, o.item_description,
              o.screening_status, o.screening_note, o.screened_at,
              o.dim_l_cm, o.dim_w_cm, o.dim_h_cm, o.chargeable_kg, o.weight_kg,
              o.image_path, o.sticker_printed_at,
              s.name AS sender_name, s.phone AS sender_phone,
              r.name AS receiver_name, r.phone AS receiver_phone
       FROM orders o
       LEFT JOIN customers s ON s.id = o.sender_id
       LEFT JOIN customers r ON r.id = o.receiver_id
       WHERE o.status IN ('RECEIVED_WH_TH','RECEIVED_WH_LA')
         AND (o.screening_status IS NULL OR o.screening_status = '')
       ORDER BY o.updated_at ASC
       LIMIT 50`
    );

    const [[stats]] = await pool.query(
      `SELECT
         SUM(CASE WHEN screening_status IS NULL OR screening_status = '' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN screening_status = 'PASSED' AND DATE(screened_at) = CURDATE() THEN 1 ELSE 0 END) AS passed_today,
         SUM(CASE WHEN screening_status = 'REJECTED' AND DATE(screened_at) = CURDATE() THEN 1 ELSE 0 END) AS rejected_today
       FROM orders
       WHERE status IN ('RECEIVED_WH_TH','RECEIVED_WH_LA','READY_TO_LOAD','SCREENING_FAILED','PENDING_CUSTOMS')`
    );

    res.render('scanner/screening', {
      user: req.session.user,
      title: 'คัดกรองพัสดุ',
      queue,
      stats: stats || { pending: 0, passed_today: 0, rejected_today: 0 },
    });
  } catch (error) {
    console.error('[Scanner] showScreening error:', error);
    res.status(500).render('errors/500', { user: req.session.user, title: 'Error' });
  }
}

// ─── POST /scanner/screening/:id — AJAX Screen + Weight Update ───────────────
export async function processScreening(req, res) {
  try {
    const { id } = req.params;
    const { result, note, actual_weight, flags } = req.body;
    const userId = req.session.user?.id;

    const VALID_RESULTS = ['PASSED', 'CUSTOMS_REQUIRED', 'REJECTED'];
    if (!VALID_RESULTS.includes(result)) {
      return res.status(400).json({ success: false, message: 'ผลคัดกรองไม่ถูกต้อง' });
    }

    const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ success: false, message: 'ไม่พบออเดอร์' });

    // Determine new status
    let newStatus = order.status;
    if (result === 'PASSED') newStatus = order.status; // Stay in same status, just mark screened
    else if (result === 'CUSTOMS_REQUIRED') newStatus = 'PENDING_CUSTOMS';
    else if (result === 'REJECTED') newStatus = 'SCREENING_FAILED';

    // Build update
    const setCols = [
      'screening_status = ?', 'screening_note = ?',
      'screened_by = ?', 'screened_at = NOW()',
      'status = ?',
    ];
    const setVals = [result, note || null, userId, newStatus];

    // Update actual weight if provided
    if (actual_weight && Number(actual_weight) > 0) {
      setCols.push('actual_weight = ?');
      setVals.push(Number(actual_weight));
    }

    setVals.push(id);
    await pool.query(`UPDATE orders SET ${setCols.join(', ')} WHERE id = ?`, setVals);

    // Save flags
    const flagList = Array.isArray(flags) ? flags : (flags ? [flags] : []);
    for (const flagType of flagList) {
      await pool.query(
        `INSERT INTO order_flags (order_id, flag_type, flagged_by) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE flagged_at = NOW()`,
        [id, flagType, userId]
      ).catch(() => {});
    }

    // Status log
    const noteMsg = result === 'PASSED'
      ? `ผ่านการคัดกรอง${actual_weight ? ' (น้ำหนักจริง: ' + actual_weight + ' กก.)' : ''}`
      : result === 'CUSTOMS_REQUIRED'
        ? `ต้องแจ้งศุลกากร: ${note || ''}`
        : `ปฏิเสธสินค้า: ${note || ''}`;

    await logStatus(id, order.status, newStatus, noteMsg, userId);

    const msgs = { PASSED: 'ผ่านการคัดกรอง', CUSTOMS_REQUIRED: 'ต้องดำเนินการศุลกากร', REJECTED: 'ปฏิเสธสินค้า' };
    res.json({ success: true, message: `✅ ${order.job_no} — ${msgs[result]}`, jobNo: order.job_no, result });
  } catch (error) {
    console.error('[Scanner] processScreening error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
  }
}

// ─── GET /scanner/auto — Auto Scan UI ─────────────────────────────────────────
export async function showAutoScan(req, res) {
  try {
    // Fetch active trips for ON_TRUCK selection
    const [trips] = await pool.query(
      `SELECT id, trip_no, driver_name 
       FROM trips 
       WHERE status IN ('PLANNED', 'IN_TRANSIT') 
       ORDER BY created_at DESC LIMIT 20`
    );
    
    res.render('scanner/auto', {
      user: req.session.user,
      title: 'สแกนอัตโนมัติ (Auto-Scan)',
      trips
    });
  } catch (error) {
    console.error('[Scanner] showAutoScan error:', error);
    res.status(500).render('errors/500', { user: req.session.user, title: 'Error' });
  }
}

// ─── POST /scanner/auto-update — Process Auto Scan ────────────────────────────
export async function processAutoScan(req, res) {
  try {
    const { barcode, target_status, trip_id } = req.body;
    const userId = req.session.user?.id;
    const userRole = req.session.user?.role || '';

    if (!barcode || !target_status) {
      return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน (Barcode / Target Status)' });
    }

    const order = await getOrderFull(barcode.trim());
    if (!order) {
      return res.status(404).json({ success: false, message: `ไม่พบพัสดุเลขที่: ${barcode.trim()}` });
    }

    if (order.status === target_status) {
      return res.status(400).json({ success: false, message: `พัสดุอยู่ในสถานะ "${target_status}" อยู่แล้ว` });
    }

    // Role-based validation
    const whThAllowed = ['RECEIVED_WH_TH', 'AT_DEST_WH', 'DELIVERED'];
    const whLaAllowed = ['RECEIVED_WH_LA', 'AT_DEST_WH', 'DELIVERED'];
    const driverAllowed = ['ON_TRUCK', 'OUT_FOR_DELIVERY', 'DELIVERED'];
    
    let isAllowed = false;
    if (['admin', 'manager'].includes(userRole)) isAllowed = true;
    else if (userRole === 'warehouse_th' && whThAllowed.includes(target_status)) isAllowed = true;
    else if (userRole === 'warehouse_la' && whLaAllowed.includes(target_status)) isAllowed = true;
    else if (['dispatcher', 'driver_support'].includes(userRole) && driverAllowed.includes(target_status)) isAllowed = true;
    else if (userRole === 'branch_operator' && ['BRANCH_RECEIVED', 'DELIVERED'].includes(target_status)) isAllowed = true;

    if (!isAllowed) {
      return res.status(403).json({ success: false, message: `ไม่มีสิทธิ์เปลี่ยนสถานะเป็น "${target_status}"` });
    }

    // Additional logic for ON_TRUCK
    if (target_status === 'ON_TRUCK') {
      if (!trip_id) {
        return res.status(400).json({ success: false, message: 'กรุณาเลือกรอบรถ (Trip ID) สำหรับการขึ้นรถ' });
      }
      // Update trip_id in orders
      await pool.query('UPDATE orders SET trip_id = ? WHERE id = ?', [trip_id, order.id]);
      
      // Ensure it's in trip_orders
      await pool.query(
        `INSERT INTO trip_orders (trip_id, order_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE trip_id = ?`,
        [trip_id, order.id, trip_id]
      );
    }

    // Update the status
    await pool.query('UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?', [target_status, order.id]);
    
    // Log
    let note = `[AUTO-SCAN] ยืนยันสถานะเป็น ${target_status}`;
    if (target_status === 'ON_TRUCK') note += ` (Trip ID: ${trip_id})`;
    await logStatus(order.id, order.status, target_status, note, userId);

    res.json({ 
      success: true, 
      message: `อัพเดทสำเร็จ: ${order.job_no} -> ${target_status}`,
      jobNo: order.job_no,
      newStatus: target_status
    });

  } catch (error) {
    console.error('[Scanner] processAutoScan error:', error);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการทำ Auto Scan' });
  }
}

