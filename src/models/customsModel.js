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
import { transitionOrder, withTransaction } from '../services/orderWorkflowService.js';
import { kickNotificationWorker } from '../services/notificationService.js';

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

  await withTransaction(async (conn) => {
    await transitionOrder({
      orderId: order.id,
      toStatus: ORDER_STATUS.CUSTOMS_HOLD,
      userId,
      note: note || 'Customs clearance started',
      source: 'CUSTOMS_START',
      connection: conn,
      allowSame: true,
    });
    const fee = Number(feeAmount);
    if (Number.isFinite(fee) && fee > 0) {
      await conn.query(
        `INSERT INTO payments (order_id, type, method, amount, currency, status, ref_no)
         VALUES (?, 'customs', 'other', ?, 'THB', 'PENDING', ?)`,
        [order.id, fee, note || 'customs fee']
      );
    }
  });
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

  await withTransaction(async (conn) => {
    await transitionOrder({ orderId: order.id, toStatus: ORDER_STATUS.CUSTOMS_CLEARED,
      userId, note: note || 'Customs cleared', source: 'CUSTOMS_CLEAR', connection: conn });
    await conn.query(
      `UPDATE payments SET status='PAID', paid_at=NOW()
       WHERE order_id=? AND type='customs' AND status='PENDING'`,
      [order.id]
    );
    await transitionOrder({ orderId: order.id, toStatus: ORDER_STATUS.ARRIVED_BORDER_WH,
      userId, note: 'Released after customs clearance', source: 'CUSTOMS_RELEASE', connection: conn });
  });
  kickNotificationWorker(order.id);
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

  await transitionOrder({
    orderId: order.id,
    toStatus: ORDER_STATUS.CUSTOMS_REJECTED,
    userId,
    note: reason || 'Customs rejected shipment',
    source: 'CUSTOMS_REJECT',
    notify: false,
  });
}
