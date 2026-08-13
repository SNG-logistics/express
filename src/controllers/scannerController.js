/**
 * src/controllers/scannerController.js — v2
 *
 * Warehouse Receive & Scan Workflow
 */

import pool from '../config/db.js';
import { SCANNER_ALLOWED_STATUSES } from '../constants/statuses.js';
import { canTransitionOrder } from '../constants/transitions.js';
import { transitionOrder, withTransaction, WorkflowError } from '../services/orderWorkflowService.js';
import { assignBranchToOrder } from './branchesController.js';
import { enqueueOrderNotification, kickNotificationWorker } from '../services/notificationService.js';
import { canAutoScanTarget, canUnloadAtDestination } from '../services/operationalAccessService.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── GET /scanner/lookup — Read-only parcel location lookup ───────────────────
export async function showLookup(req, res) {
  try {
    const [recentSearches] = await pool.query(
      `SELECT o.id, o.job_no, o.status, o.updated_at,
              s.name AS sender_name, r.name AS receiver_name
       FROM orders o
       LEFT JOIN customers s ON o.sender_id = s.id
       LEFT JOIN customers r ON o.receiver_id = r.id
       ORDER BY o.updated_at DESC
       LIMIT 10`
    );
    res.render('scanner/lookup', {
      user: req.session.user,
      title: 'ค้นหาพัสดุ',
      recentSearches,
    });
  } catch (error) {
    console.error('[Scanner] showLookup error:', error);
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

    const isMgr = ['owner','admin','manager'].includes(userRole);
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

    const updates = {};
    if (weight_actual) updates.actual_weight = Number(weight_actual);
    if (photoUrls.length > 0) updates.intake_photos = JSON.stringify(photoUrls);
    await transitionOrder({
      orderId: id,
      toStatus,
      userId,
      note: auditNote,
      source: 'SCANNER_RECEIVE',
      updates,
      afterTransition: condition === 'DAMAGED'
        ? async (conn) => conn.query(
          `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
           VALUES (?, ?, ?, ?, ?)`,
          [id, toStatus, toStatus, `[EXCEPTION] DAMAGED — ${note || 'No note'}`, userId]
        )
        : null,
    });

    res.json({ success: true, message: `รับเข้าคลังสำเร็จ${condLabel ? ' (' + condition + ')' : ''}`, newStatus: toStatus, jobNo: order.job_no });
  } catch (error) {
    console.error('[Scanner] receiveParcel error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'เกิดข้อผิดพลาด' });
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

    await transitionOrder({
      orderId,
      toStatus: 'ON_TRUCK',
      userId,
      note: `[HANDOFF] trip_id:${tripId}`,
      source: 'SCANNER_HANDOFF',
    });

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
    const userRole = req.session.user?.role || '';

    const [[order]] = await pool.query(
      'SELECT id, status, job_no, trip_id, direction FROM orders WHERE id = ?',
      [orderId]
    );
    if (!order) return res.status(404).json({ success: false, message: 'ไม่พบออเดอร์' });
    if (String(order.trip_id) !== String(tripId)) return res.status(400).json({ success: false, message: 'ออเดอร์ไม่ได้อยู่ในรอบรถนี้' });
    if (order.status === 'AT_DEST_WH') return res.json({ success: true, message: 'รับลงคลังแล้ว', alreadyDone: true });
    
    await transitionOrder({
      orderId,
      toStatus: 'AT_DEST_WH',
      userId,
      note: `[UNLOAD] trip_id:${tripId}`,
      source: 'SCANNER_UNLOAD',
      afterTransition: async (conn) => {
        const [[trip]] = await conn.query('SELECT status, direction FROM trips WHERE id=? FOR UPDATE', [tripId]);
        if (!trip || !['ARRIVED', 'UNLOADING'].includes(trip.status)) {
          throw new WorkflowError('Trip must be ARRIVED or UNLOADING before unload', 409);
        }
        if (!canUnloadAtDestination({
          role: userRole,
          orderDirection: order.direction,
          tripDirection: trip.direction,
        })) {
          throw new WorkflowError('This warehouse cannot unload the selected trip direction', 403, 'WRONG_WAREHOUSE');
        }
        await conn.query(
          'UPDATE trip_orders SET unloaded_at=NOW() WHERE trip_id=? AND order_id=?',
          [tripId, orderId]
        );
        await assignBranchToOrder(orderId, conn);
      },
    });

    res.json({ success: true, message: `รับลงคลัง ${order.job_no} สำเร็จ`, jobNo: order.job_no });
  } catch (error) {
    console.error('[Scanner] confirmUnload error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'เกิดข้อผิดพลาด',
    });
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

    await transitionOrder({
      orderId: id,
      toStatus: status,
      userId,
      note: '[QUICK-SCAN]',
      source: 'SCANNER_QUICK',
    });
    res.json({ success: true, message: 'อัพเดทสถานะสำเร็จ' });
  } catch (error) {
    console.error('[Scanner] quickStatusUpdate error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'เกิดข้อผิดพลาดในการอัปเดตสถานะ' });
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

// ─── GET /scanner/pda — PDA Mode (iT78 / keyboard-wedge scanners) ────────────
export async function showPda(req, res) {
  try {
    const [trips] = await pool.query(
      `SELECT id, trip_no, driver_name
       FROM trips
       WHERE status IN ('PLANNED','LOADING')
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
         AND (o.screening_status IS NULL OR o.screening_status IN ('', 'PENDING'))
       ORDER BY o.updated_at ASC
       LIMIT 50`
    );

    const [[stats]] = await pool.query(
      `SELECT
         SUM(CASE WHEN screening_status IS NULL OR screening_status IN ('', 'PENDING') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN screening_status = 'PASSED' AND DATE(screened_at) = CURDATE() THEN 1 ELSE 0 END) AS passed_today,
         SUM(CASE WHEN screening_status = 'REJECTED' AND DATE(screened_at) = CURDATE() THEN 1 ELSE 0 END) AS rejected_today
       FROM orders
       WHERE status IN ('RECEIVED_WH_TH','RECEIVED_WH_LA')`
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

    // Build update
    const setCols = [
      'screening_status = ?', 'screening_note = ?',
      'screened_by = ?', 'screened_at = NOW()',
    ];
    const setVals = [result, note || null, userId];

    // Update actual weight if provided
    if (actual_weight && Number(actual_weight) > 0) {
      setCols.push('actual_weight = ?');
      setVals.push(Number(actual_weight));
    }

    const flagList = Array.isArray(flags) ? flags : (flags ? [flags] : []);
    const noteMsg = result === 'PASSED'
      ? `ผ่านการคัดกรอง${actual_weight ? ' (น้ำหนักจริง: ' + actual_weight + ' กก.)' : ''}`
      : result === 'CUSTOMS_REQUIRED'
        ? `ต้องแจ้งศุลกากร: ${note || ''}`
        : `ปฏิเสธสินค้า: ${note || ''}`;

    await withTransaction(async (conn) => {
      setVals.push(id);
      await conn.query(`UPDATE orders SET ${setCols.join(', ')} WHERE id = ?`, setVals);
      for (const flagType of flagList) {
        await conn.query(
          `INSERT INTO order_flags (order_id, flag_type, flagged_by) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE flagged_at=NOW()`,
          [id, flagType, userId]
        );
      }
      const [logResult] = await conn.query(
        `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
         VALUES (?, ?, ?, ?, ?)`,
        [id, order.status, order.status, `[SCREENING:${result}] ${noteMsg}`, userId]
      );
      if (result !== 'PASSED') {
        await enqueueOrderNotification(conn, {
          orderId: id,
          status: `SCREENING_${result}`,
          eventKey: `ORDER_STATUS_LOG:${logResult.insertId}`,
          source: 'SCANNER_SCREENING',
        });
      }
    });
    if (result !== 'PASSED') kickNotificationWorker(id);

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
       WHERE status IN ('PLANNED', 'LOADING')
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
    const autoAllowedStatuses = new Set([
      'RECEIVED_WH_TH', 'RECEIVED_WH_LA', 'ON_TRUCK',
      'AT_DEST_WH', 'BRANCH_RECEIVED', 'OUT_FOR_DELIVERY',
    ]);
    if (!autoAllowedStatuses.has(target_status)) {
      return res.status(400).json({ success: false, message: `สถานะ "${target_status}" ต้องใช้ขั้นตอนที่มีหลักฐานเฉพาะ` });
    }

    const order = await getOrderFull(barcode.trim());
    if (!order) {
      return res.status(404).json({ success: false, message: `ไม่พบพัสดุเลขที่: ${barcode.trim()}` });
    }

    if (order.status === target_status) {
      return res.status(400).json({ success: false, message: `พัสดุอยู่ในสถานะ "${target_status}" อยู่แล้ว` });
    }

    if (!canAutoScanTarget({
      role: userRole,
      targetStatus: target_status,
      order,
      sessionBranchId: req.session.user?.branch_id,
    })) {
      return res.status(403).json({ success: false, message: `ไม่มีสิทธิ์เปลี่ยนสถานะเป็น "${target_status}"` });
    }

    if (!canTransitionOrder(order.status, target_status)) {
      return res.status(409).json({ success: false, message: `ไม่สามารถเปลี่ยน ${order.status} → ${target_status}` });
    }

    // Additional logic for ON_TRUCK
    if (target_status === 'ON_TRUCK') {
      if (!trip_id) {
        return res.status(400).json({ success: false, message: 'กรุณาเลือกรอบรถ (Trip ID) สำหรับการขึ้นรถ' });
      }
    }

    let note = `[AUTO-SCAN] ยืนยันสถานะเป็น ${target_status}`;
    if (target_status === 'ON_TRUCK') note += ` (Trip ID: ${trip_id})`;
    await transitionOrder({
      orderId: order.id,
      toStatus: target_status,
      userId,
      note,
      source: 'SCANNER_AUTO',
      updates: target_status === 'ON_TRUCK' ? { trip_id: Number(trip_id) } : {},
      afterTransition: target_status === 'ON_TRUCK'
        ? async (conn) => {
          const [[trip]] = await conn.query('SELECT * FROM trips WHERE id=? FOR UPDATE', [trip_id]);
          if (!trip || !['PLANNED','LOADING'].includes(trip.status)) {
            throw new WorkflowError('Trip is not available for loading', 409);
          }
          if (trip.direction !== order.direction) {
            throw new WorkflowError('Order direction does not match trip direction', 409);
          }
          const [[weight]] = await conn.query(
            `SELECT COALESCE(SUM(COALESCE(o.actual_weight,o.declared_weight,o.weight_kg,0)),0) total
             FROM trip_orders t JOIN orders o ON o.id=t.order_id WHERE t.trip_id=?`,
            [trip_id]
          );
          const orderWeight = Number(order.actual_weight || order.declared_weight || order.weight_kg || 0);
          if (trip.max_weight && Number(weight.total) + orderWeight > Number(trip.max_weight)) {
            throw new WorkflowError('Trip capacity would be exceeded', 409);
          }
          await conn.query(
            `INSERT INTO trip_orders (trip_id, order_id) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE trip_id=VALUES(trip_id)`,
            [trip_id, order.id]
          );
        }
        : null,
    });

    res.json({ 
      success: true, 
      message: `อัพเดทสำเร็จ: ${order.job_no} -> ${target_status}`,
      jobNo: order.job_no,
      newStatus: target_status
    });

  } catch (error) {
    console.error('[Scanner] processAutoScan error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'เกิดข้อผิดพลาดในการทำ Auto Scan' });
  }
}
