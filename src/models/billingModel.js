/**
 * billingModel.js — Monthly billing statements (net-off against COD)
 *
 * A `billing_statement` snapshots every MONTHLY_BILL order for one credit sender
 * within a finance-picked date range, nets total COD collected against total
 * shipping fees owed, and — on settle — bulk-closes each included order by
 * reusing the same transitions codModel.js uses one order at a time:
 *   COD orders:     COD_COLLECTED → COD_REMITTED → CLOSED
 *   non-COD orders: DELIVERED → CLOSED
 *
 * Eligibility for inclusion (enforced in listEligibleOrders, re-checked under
 * FOR UPDATE in createStatement):
 *   - order.sender_id = customer, order.payment_method = 'MONTHLY_BILL'
 *   - order.created_at falls inside [period_start, period_end]
 *   - order not already on another billing_items row (UNIQUE order_id)
 *   - cod_amount = 0  → order.status = 'DELIVERED'
 *   - cod_amount > 0  → order.status = 'COD_COLLECTED' AND cod_settlements.status = 'COLLECTED'
 *     (COD not yet collected is never included — matches the "COLLECTED only" rule)
 */
import pool from '../config/db.js';
import { ORDER_STATUS } from '../constants/statuses.js';
import { transitionOrder, withTransaction, WorkflowError } from '../services/orderWorkflowService.js';

// ─── Credit customers ─────────────────────────────────────────────────────────

export async function listCreditCustomers() {
  const [rows] = await pool.query(
    `SELECT id, name, phone FROM customers WHERE is_credit = 1 AND active = 1 ORDER BY name ASC`
  );
  return rows;
}

// ─── Eligible orders for a prospective statement ──────────────────────────────

export async function listEligibleOrders(customerId, periodStart, periodEnd, conn = pool) {
  const [rows] = await conn.query(
    `SELECT o.id, o.job_no, o.created_at, o.price_amount, o.cod_amount, o.status,
            cs.status AS cod_status
     FROM orders o
     LEFT JOIN cod_settlements cs ON cs.order_id = o.id
     LEFT JOIN billing_items bi ON bi.order_id = o.id
     WHERE o.sender_id = ?
       AND o.payment_method = 'MONTHLY_BILL'
       AND o.created_at >= ? AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)
       AND bi.id IS NULL
       AND (
         (o.cod_amount = 0 AND o.status = 'DELIVERED')
         OR (o.cod_amount > 0 AND o.status = 'COD_COLLECTED' AND cs.status = 'COLLECTED')
       )
     ORDER BY o.created_at ASC`,
    [customerId, periodStart, periodEnd]
  );
  return rows;
}

// ─── Create statement (snapshot + net-off calc) ───────────────────────────────

export async function createStatement({ customerId, periodStart, periodEnd, userId }) {
  return withTransaction(async (conn) => {
    const [[customer]] = await conn.query(
      'SELECT id, name, is_credit FROM customers WHERE id = ? FOR UPDATE', [customerId]
    );
    if (!customer) throw new WorkflowError('Customer not found', 404);
    if (!customer.is_credit) throw new WorkflowError('Customer is not credit-approved (is_credit=0)', 409);

    const orders = await listEligibleOrders(customerId, periodStart, periodEnd, conn);
    if (orders.length === 0) throw new WorkflowError('No eligible orders in this period', 409);

    let totalCod = 0;
    let totalShipping = 0;
    for (const o of orders) {
      totalCod += Number(o.cod_amount);
      totalShipping += Number(o.price_amount);
    }
    const netAmount = totalCod - totalShipping;

    const [result] = await conn.query(
      `INSERT INTO billing_statements
         (customer_id, period_start, period_end, total_cod, total_shipping, net_amount, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
      [customerId, periodStart, periodEnd, totalCod, totalShipping, netAmount, userId]
    );
    const statementId = result.insertId;

    for (const o of orders) {
      await conn.query(
        `INSERT INTO billing_items (statement_id, order_id, shipping_fee, cod_amount)
         VALUES (?, ?, ?, ?)`,
        [statementId, o.id, o.price_amount, o.cod_amount]
      );
    }

    return getStatement(statementId, conn);
  });
}

// ─── Read ──────────────────────────────────────────────────────────────────────

export async function listStatements(customerId = null) {
  const params = [];
  let where = '';
  if (customerId) {
    where = 'WHERE bs.customer_id = ?';
    params.push(customerId);
  }
  const [rows] = await pool.query(
    `SELECT bs.*, c.name AS customer_name
     FROM billing_statements bs
     JOIN customers c ON c.id = bs.customer_id
     ${where}
     ORDER BY bs.created_at DESC`,
    params
  );
  return rows;
}

export async function getStatement(id, conn = pool) {
  const [[statement]] = await conn.query(
    `SELECT bs.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address
     FROM billing_statements bs
     JOIN customers c ON c.id = bs.customer_id
     WHERE bs.id = ?`,
    [id]
  );
  if (!statement) return null;
  const [items] = await conn.query(
    `SELECT bi.*, o.job_no, o.created_at AS order_created_at
     FROM billing_items bi
     JOIN orders o ON o.id = bi.order_id
     WHERE bi.statement_id = ?
     ORDER BY o.created_at ASC`,
    [id]
  );
  return { ...statement, items };
}

// ─── Settle (bulk close every included order) ─────────────────────────────────

export async function settleStatement(id, userId) {
  return withTransaction(async (conn) => {
    const [[statement]] = await conn.query(
      'SELECT * FROM billing_statements WHERE id = ? FOR UPDATE', [id]
    );
    if (!statement) throw new WorkflowError('Statement not found', 404);
    if (statement.status !== 'OPEN') throw new WorkflowError(`Statement already ${statement.status}`, 409);

    const [items] = await conn.query('SELECT * FROM billing_items WHERE statement_id = ?', [id]);
    const remittedTo = `Billing Statement #${id} (net-off)`;

    for (const item of items) {
      const [[order]] = await conn.query('SELECT status FROM orders WHERE id = ? FOR UPDATE', [item.order_id]);
      if (!order) throw new WorkflowError(`Order ${item.order_id} not found`, 404);

      if (Number(item.cod_amount) > 0) {
        if (order.status !== ORDER_STATUS.COD_COLLECTED) {
          throw new WorkflowError(`Order ${item.order_id} is no longer COD_COLLECTED (now ${order.status})`, 409);
        }
        await conn.query(
          `UPDATE cod_settlements SET status='REMITTED', remitted_at=NOW(), remitted_to=?
           WHERE order_id=? AND status='COLLECTED'`,
          [remittedTo, item.order_id]
        );
        await transitionOrder({
          orderId: item.order_id, toStatus: ORDER_STATUS.COD_REMITTED, userId,
          note: `COD remitted via ${remittedTo}`, source: 'BILLING_SETTLE', connection: conn, notify: false,
        });
        await transitionOrder({
          orderId: item.order_id, toStatus: ORDER_STATUS.CLOSED, userId,
          note: `Closed via ${remittedTo}`, source: 'BILLING_SETTLE', connection: conn, notify: false,
        });
      } else {
        if (order.status !== ORDER_STATUS.DELIVERED) {
          throw new WorkflowError(`Order ${item.order_id} is no longer DELIVERED (now ${order.status})`, 409);
        }
        await transitionOrder({
          orderId: item.order_id, toStatus: ORDER_STATUS.CLOSED, userId,
          note: `Closed via ${remittedTo} (no COD)`, source: 'BILLING_SETTLE', connection: conn, notify: false,
        });
      }
    }

    await conn.query(
      `UPDATE billing_statements SET status='SETTLED', settled_by=?, settled_at=NOW() WHERE id=?`,
      [userId, id]
    );
    return getStatement(id, conn);
  });
}
