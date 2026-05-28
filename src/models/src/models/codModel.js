import pool from '../config/db.js';

export async function listOutstanding() {
  const [rows] = await pool.query(
    `SELECT o.id, o.job_no, o.direction, o.status,
            COALESCE(o.cod_amount,0) AS cod_amount,
            cs.status AS cod_status,
            cs.collected_at,
            cs.remitted_at,
            cs.remitted_to
     FROM orders o
     LEFT JOIN cod_settlements cs ON cs.order_id = o.id
     WHERE o.cod_amount > 0
     ORDER BY o.created_at DESC
     LIMIT 200`
  );
  return rows;
}

export async function getSettlement(orderId) {
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
  const [[settlement]] = await pool.query('SELECT * FROM cod_settlements WHERE order_id = ? LIMIT 1', [orderId]);
  return { order, settlement };
}

export async function ensureCodRow(orderId, codAmount) {
  await pool.query(
    `INSERT INTO cod_settlements (order_id, cod_amount, status)
     VALUES (?, ?, 'PENDING')
     ON DUPLICATE KEY UPDATE cod_amount = VALUES(cod_amount)`,
    [orderId, codAmount]
  );
}

export async function markCollected(orderId, userId) {
  await pool.query(
    `UPDATE cod_settlements
     SET status = 'COLLECTED', collected_at = NOW(), remitted_at = NULL
     WHERE order_id = ?`,
    [orderId]
  );
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, ?, ?)`,
    [orderId, 'DELIVERED', 'COD_COLLECTED', 'เก็บ COD แล้ว', userId || null]
  );
  await pool.query(
    `UPDATE orders SET status = 'COD_COLLECTED' WHERE id = ? AND status = 'DELIVERED'`,
    [orderId]
  );
}

export async function markRemitted(orderId, remittedTo, userId) {
  await pool.query(
    `UPDATE cod_settlements
     SET status = 'REMITTED', remitted_at = NOW(), remitted_to = ?
     WHERE order_id = ?`,
    [remittedTo || '', orderId]
  );
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, ?, ?)`,
    [orderId, 'COD_COLLECTED', 'CLOSED', `โอน COD ให้ลูกค้า: ${remittedTo || ''}`, userId || null]
  );
  await pool.query(
    `UPDATE orders SET status = 'CLOSED' WHERE id = ? AND status IN ('DELIVERED','COD_COLLECTED')`,
    [orderId]
  );
}
