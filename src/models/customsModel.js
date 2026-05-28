/**
 * customsModel.js — Customs clearance model
 *
 * Status flow:
 *   CROSSING_BORDER | ARRIVED_BORDER_WH
 *     → CUSTOMS_HOLD       (start clearance — waiting for approval)
 *     → CUSTOMS_CLEARED    (approved → proceed to ARRIVED_BORDER_WH)
 *     → CUSTOMS_REJECTED   (rejected → CLOSED)
 *
 * All writes use ORDER_STATUS constants — no legacy literal strings.
 */
import pool from '../config/db.js';
import { ORDER_STATUS } from '../constants/statuses.js';

// Statuses that can enter customs processing
const CUSTOMS_ELIGIBLE_STATUSES = [
  ORDER_STATUS.CROSSING_BORDER,
  ORDER_STATUS.ARRIVED_BORDER_WH,
  ORDER_STATUS.CUSTOMS_HOLD, // allow re-entry for fee updates
];

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Orders that are waiting for / in customs processing.
 * Replaces hard-coded 'CUSTOMS_CLEARANCE' legacy value.
 */
export async function getPendingOrders() {
  const [rows] = await pool.query(
    `SELECT o.id, o.job_no, o.direction, o.status, o.price_amount, o.cod_amount,
            o.requires_customs, o.created_at, o.updated_at,
            s.name AS sender_name,
            r.name AS receiver_name
     FROM orders o
     LEFT JOIN customers s ON s.id = o.sender_id
     LEFT JOIN customers r ON r.id = o.receiver_id
     WHERE o.status IN (?, ?, ?)
     ORDER BY o.created_at ASC
     LIMIT 200`,
    [
      ORDER_STATUS.CROSSING_BORDER,
      ORDER_STATUS.ARRIVED_BORDER_WH,
      ORDER_STATUS.CUSTOMS_HOLD,
    ]
  );
  return rows;
}

export async function getOrderWithLogs(orderId) {
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) return { order: null, logs: [], payments: [] };

  const [logs] = await pool.query(
    `SELECT osl.*, u.username
     FROM order_status_logs osl
     LEFT JOIN users u ON u.id = osl.action_by
     WHERE osl.order_id = ?
     ORDER BY osl.action_at DESC`,
    [orderId]
  );
  const [payments] = await pool.query(
    `SELECT * FROM payments WHERE order_id = ? AND type = 'customs' ORDER BY created_at DESC`,
    [orderId]
  );
  return { order, logs, payments };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Start customs clearance — move order to CUSTOMS_HOLD.
 * Optionally record a customs fee payment.
 *
 * Guard: order must be in a customs-eligible status.
 */
export async function startClearance(order, feeAmount, note, userId) {
  if (!CUSTOMS_ELIGIBLE_STATUSES.includes(order.status)) {
    throw new Error(
      `Order ${order.job_no} อยู่ในสถานะ "${order.status}" — ไม่สามารถเริ่มพิธีศุลกากรได้`
    );
  }

  const fromStatus = order.status;
  const toStatus   = ORDER_STATUS.CUSTOMS_HOLD;

  await pool.query('UPDATE orders SET status = ? WHERE id = ?', [toStatus, order.id]);
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, ?, ?)`,
    [order.id, fromStatus, toStatus, note || 'เริ่มพิธีการศุลกากร', userId || null]
  );

  // Record customs fee if provided
  const fee = Number(feeAmount);
  if (!Number.isNaN(fee) && fee > 0) {
    await pool.query(
      `INSERT INTO payments (order_id, type, method, amount, currency, status, ref_no)
       VALUES (?, 'customs', 'other', ?, 'THB', 'PENDING', ?)`,
      [order.id, fee, note || 'customs fee']
    );
  }
}

/**
 * Mark customs as CLEARED → order moves to ARRIVED_BORDER_WH.
 * Also marks any PENDING customs payment as PAID.
 *
 * Guard: order must be in CUSTOMS_HOLD.
 */
export async function clearOrder(order, note, userId) {
  if (order.status !== ORDER_STATUS.CUSTOMS_HOLD) {
    throw new Error(
      `Order ${order.job_no} อยู่ในสถานะ "${order.status}" — ต้องอยู่ใน CUSTOMS_HOLD ก่อน Clearance`
    );
  }

  // Move order to CUSTOMS_CLEARED first, then ARRIVED_BORDER_WH
  await pool.query(
    'UPDATE orders SET status = ? WHERE id = ?',
    [ORDER_STATUS.CUSTOMS_CLEARED, order.id]
  );
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, ?, ?)`,
    [
      order.id,
      ORDER_STATUS.CUSTOMS_HOLD,
      ORDER_STATUS.CUSTOMS_CLEARED,
      note || 'ผ่านพิธีการศุลกากร',
      userId || null,
    ]
  );

  // Mark any pending customs payment as PAID
  await pool.query(
    `UPDATE payments SET status = 'PAID', paid_at = NOW()
     WHERE order_id = ? AND type = 'customs' AND status = 'PENDING'`,
    [order.id]
  );

  // Auto-advance to ARRIVED_BORDER_WH (customs cleared → continue journey)
  await pool.query(
    'UPDATE orders SET status = ? WHERE id = ?',
    [ORDER_STATUS.ARRIVED_BORDER_WH, order.id]
  );
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, 'ส่งต่อหลังผ่านพิธีศุลกากร', ?)`,
    [order.id, ORDER_STATUS.CUSTOMS_CLEARED, ORDER_STATUS.ARRIVED_BORDER_WH, userId || null]
  );
}

/**
 * Reject order at customs → order moves to CUSTOMS_REJECTED → CLOSED.
 * Logs both transitions.
 */
export async function rejectOrder(order, reason, userId) {
  if (order.status !== ORDER_STATUS.CUSTOMS_HOLD) {
    throw new Error(
      `Order ${order.job_no} อยู่ในสถานะ "${order.status}" — ต้องอยู่ใน CUSTOMS_HOLD ก่อน Reject`
    );
  }

  await pool.query(
    'UPDATE orders SET status = ? WHERE id = ?',
    [ORDER_STATUS.CUSTOMS_REJECTED, order.id]
  );
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, ?, ?)`,
    [
      order.id,
      ORDER_STATUS.CUSTOMS_HOLD,
      ORDER_STATUS.CUSTOMS_REJECTED,
      reason || 'ศุลกากรไม่อนุมัติ',
      userId || null,
    ]
  );
}
