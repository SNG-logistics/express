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
import { transitionOrder, withTransaction, WorkflowError } from '../services/orderWorkflowService.js';

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
export async function ensureCodRow(orderId, codAmount, conn = pool) {
  await conn.query(
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
  return withTransaction(async (conn) => {
    const [[order]] = await conn.query('SELECT status, cod_amount FROM orders WHERE id=? FOR UPDATE', [orderId]);
    if (!order) throw new WorkflowError('Order not found', 404);
    if (order.status === ORDER_STATUS.COD_COLLECTED) return { changed: false };
    if (order.status !== ORDER_STATUS.DELIVERED || Number(order.cod_amount) <= 0) {
      throw new WorkflowError(`COD collection requires a delivered COD order (${order.status})`, 409);
    }
    await ensureCodRow(orderId, order.cod_amount, conn);
    await conn.query(
      `UPDATE cod_settlements SET status='COLLECTED', collected_at=NOW()
       WHERE order_id=? AND status='PENDING'`,
      [orderId]
    );
    return transitionOrder({
      orderId,
      toStatus: ORDER_STATUS.COD_COLLECTED,
      userId,
      note: 'COD collected from customer',
      source: 'COD_COLLECT',
      updates: { cod_collected_amount: Number(order.cod_amount) },
      connection: conn,
      notify: false,
    });
  });
}

/**
 * Mark COD as remitted (cash forwarded back to sender / HQ).
 * Order: COD_COLLECTED → COD_REMITTED → CLOSED
 * Settlement: COLLECTED → REMITTED
 *
 * Guard: settlement must be COLLECTED, order must be COD_COLLECTED.
 */
export async function markRemitted(orderId, remittedTo, userId) {
  return withTransaction(async (conn) => {
    const [[order]] = await conn.query('SELECT status FROM orders WHERE id=? FOR UPDATE', [orderId]);
    const [[settlement]] = await conn.query(
      'SELECT status FROM cod_settlements WHERE order_id=? FOR UPDATE', [orderId]
    );
    if (!order || !settlement) throw new WorkflowError('Order or COD settlement not found', 404);
    if (settlement.status !== 'COLLECTED' || order.status !== ORDER_STATUS.COD_COLLECTED) {
      throw new WorkflowError('COD must be collected before remittance', 409);
    }
    await conn.query(
      `UPDATE cod_settlements SET status='REMITTED', remitted_at=NOW(), remitted_to=?
       WHERE order_id=? AND status='COLLECTED'`,
      [remittedTo || '', orderId]
    );
    return transitionOrder({
      orderId,
      toStatus: ORDER_STATUS.COD_REMITTED,
      userId,
      note: `COD remitted to ${remittedTo || '-'}`,
      source: 'COD_REMIT',
      connection: conn,
      notify: false,
    });
  });
}

/**
 * Close a COD order after remittance.
 * Order: COD_REMITTED → CLOSED
 * Called explicitly by the finance/manager, not auto-closed.
 */
export async function closeAfterRemit(orderId, userId) {
  return transitionOrder({
    orderId,
    toStatus: ORDER_STATUS.CLOSED,
    userId,
    note: 'Order closed after COD remittance',
    source: 'COD_CLOSE',
    notify: false,
  });
}
