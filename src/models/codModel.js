/**
 * codModel.js — COD settlement model
 *
 * Status flow (cod_settlements.status):
 *   PENDING → COLLECTED → REMITTED
 *
 * Matching order status flow:
 *   DELIVERED → COD_COLLECTED → COD_REMITTED → CLOSED
 *
 * All writes use ORDER_STATUS constants — no literal strings.
 */
import pool from '../config/db.js';
import { ORDER_STATUS } from '../constants/statuses.js';

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function listOutstanding() {
  const [rows] = await pool.query(
    `SELECT o.id, o.job_no, o.direction, o.status,
            COALESCE(o.cod_amount, 0) AS cod_amount,
            cs.status AS cod_status,
            cs.collected_at,
            cs.remitted_at,
            cs.remitted_to,
            s.name AS sender_name,
            r.name AS receiver_name, r.phone AS receiver_phone
     FROM orders o
     LEFT JOIN cod_settlements cs ON cs.order_id = o.id
     LEFT JOIN customers s ON s.id = o.sender_id
     LEFT JOIN customers r ON r.id = o.receiver_id
     WHERE o.cod_amount > 0
     ORDER BY o.created_at DESC
     LIMIT 200`
  );
  return rows;
}

export async function getSettlement(orderId) {
  const [[order]]      = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
  const [[settlement]] = await pool.query(
    'SELECT * FROM cod_settlements WHERE order_id = ? LIMIT 1', [orderId]
  );
  return { order, settlement };
}

/**
 * Upsert cod_settlements row when an order with COD is created / edited.
 */
export async function ensureCodRow(orderId, codAmount) {
  await pool.query(
    `INSERT INTO cod_settlements (order_id, cod_amount, status)
     VALUES (?, ?, 'PENDING')
     ON DUPLICATE KEY UPDATE cod_amount = VALUES(cod_amount)`,
    [orderId, codAmount]
  );
}

/**
 * Mark COD as collected (cash received from customer at delivery).
 * Order: DELIVERED → COD_COLLECTED
 * Settlement: PENDING → COLLECTED
 *
 * Guard: order must be in DELIVERED status.
 */
export async function markCollected(orderId, userId) {
  const [[order]] = await pool.query('SELECT status FROM orders WHERE id = ?', [orderId]);
  if (!order) throw new Error('ไม่พบ order');

  // Accept DELIVERED or already COD_COLLECTED (idempotent)
  const validFromStatuses = [ORDER_STATUS.DELIVERED, ORDER_STATUS.COD_COLLECTED];
  if (!validFromStatuses.includes(order.status)) {
    throw new Error(
      `ไม่สามารถเก็บ COD ได้ — order อยู่ในสถานะ "${order.status}" (ต้องเป็น DELIVERED)`
    );
  }

  const fromStatus = order.status;

  await pool.query(
    `UPDATE cod_settlements
     SET status = 'COLLECTED', collected_at = NOW()
     WHERE order_id = ?`,
    [orderId]
  );
  await pool.query(
    `UPDATE orders SET status = ? WHERE id = ? AND status = ?`,
    [ORDER_STATUS.COD_COLLECTED, orderId, ORDER_STATUS.DELIVERED]
  );
  // Only log if actually changed
  if (fromStatus === ORDER_STATUS.DELIVERED) {
    await pool.query(
      `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
       VALUES (?, ?, ?, 'เก็บ COD จากลูกค้าแล้ว', ?)`,
      [orderId, ORDER_STATUS.DELIVERED, ORDER_STATUS.COD_COLLECTED, userId || null]
    );
  }
}

/**
 * Mark COD as remitted (cash forwarded back to sender / HQ).
 * Order: COD_COLLECTED → COD_REMITTED → CLOSED
 * Settlement: COLLECTED → REMITTED
 *
 * Guard: settlement must be COLLECTED, order must be COD_COLLECTED.
 */
export async function markRemitted(orderId, remittedTo, userId) {
  const [[order]]      = await pool.query('SELECT status FROM orders WHERE id = ?', [orderId]);
  const [[settlement]] = await pool.query(
    'SELECT status FROM cod_settlements WHERE order_id = ? LIMIT 1', [orderId]
  );

  if (!order)      throw new Error('ไม่พบ order');
  if (!settlement) throw new Error('ไม่มี cod_settlements record — กรุณา Collect ก่อน');

  if (settlement.status !== 'COLLECTED') {
    throw new Error(
      `ไม่สามารถ Remit ได้ — settlement อยู่ในสถานะ "${settlement.status}" (ต้องเป็น COLLECTED)`
    );
  }
  if (order.status !== ORDER_STATUS.COD_COLLECTED) {
    throw new Error(
      `ไม่สามารถ Remit ได้ — order อยู่ในสถานะ "${order.status}" (ต้องเป็น COD_COLLECTED)`
    );
  }

  // Step 1: settlement → REMITTED
  await pool.query(
    `UPDATE cod_settlements
     SET status = 'REMITTED', remitted_at = NOW(), remitted_to = ?
     WHERE order_id = ?`,
    [remittedTo || '', orderId]
  );

  // Step 2: order → COD_REMITTED (not CLOSED yet — CLOSED is a separate action)
  await pool.query(
    `UPDATE orders SET status = ? WHERE id = ? AND status = ?`,
    [ORDER_STATUS.COD_REMITTED, orderId, ORDER_STATUS.COD_COLLECTED]
  );

  // Step 3: Log COD_COLLECTED → COD_REMITTED
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, ?, ?)`,
    [
      orderId,
      ORDER_STATUS.COD_COLLECTED,
      ORDER_STATUS.COD_REMITTED,
      `โอน COD คืนลูกค้า/ต้นทาง: ${remittedTo || '–'}`,
      userId || null,
    ]
  );
}

/**
 * Close a COD order after remittance.
 * Order: COD_REMITTED → CLOSED
 * Called explicitly by the finance/manager, not auto-closed.
 */
export async function closeAfterRemit(orderId, userId) {
  const [[order]] = await pool.query('SELECT status FROM orders WHERE id = ?', [orderId]);
  if (!order) throw new Error('ไม่พบ order');
  if (order.status !== ORDER_STATUS.COD_REMITTED) {
    throw new Error(
      `ยังปิดไม่ได้ — order อยู่ใน "${order.status}" (ต้อง COD_REMITTED ก่อน)`
    );
  }

  await pool.query(
    `UPDATE orders SET status = ? WHERE id = ?`,
    [ORDER_STATUS.CLOSED, orderId]
  );
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, 'ปิด order หลัง Remit COD', ?)`,
    [orderId, ORDER_STATUS.COD_REMITTED, ORDER_STATUS.CLOSED, userId || null]
  );
}
