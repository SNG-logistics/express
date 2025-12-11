import pool from '../config/db.js';

export async function getPendingOrders() {
  const [rows] = await pool.query(
    `SELECT id, job_no, direction, status, price_amount, cod_amount
     FROM orders
     WHERE status IN ('CROSSING_BORDER','ARRIVED_BORDER_WH','CUSTOMS_CLEARANCE')
     ORDER BY created_at DESC
     LIMIT 200`
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
     WHERE order_id = ?
     ORDER BY action_at DESC`,
    [orderId]
  );
  const [payments] = await pool.query(
    `SELECT * FROM payments WHERE order_id = ? AND type = 'customs' ORDER BY created_at DESC`,
    [orderId]
  );
  return { order, logs, payments };
}

export async function startClearance(order, feeAmount, note, userId) {
  const toStatus = 'CUSTOMS_CLEARANCE';
  await pool.query('UPDATE orders SET status = ? WHERE id = ?', [toStatus, order.id]);
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, ?, ?)`,
    [order.id, order.status, toStatus, note || 'เริ่มพิธีการ', userId || null]
  );
  if (feeAmount && !Number.isNaN(Number(feeAmount)) && Number(feeAmount) > 0) {
    await pool.query(
      `INSERT INTO payments (order_id, type, method, amount, currency, status, ref_no)
       VALUES (?, 'customs', 'other', ?, 'THB', 'PENDING', ?)`,
      [order.id, Number(feeAmount), note || 'customs fee']
    );
  }
}

export async function clearOrder(order, note, userId) {
  const toStatus = 'CLEARED';
  await pool.query('UPDATE orders SET status = ? WHERE id = ?', [toStatus, order.id]);
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, ?, ?)`,
    [order.id, order.status, toStatus, note || 'ผ่านพิธีการ', userId || null]
  );
}
