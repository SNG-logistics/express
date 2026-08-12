import pool from '../config/db.js';
import { canTransitionOrder, resolveStatus } from '../constants/transitions.js';
import { enqueueOrderNotification, kickNotificationWorker } from './notificationService.js';

const UPDATE_COLUMNS = new Set([
  'trip_id', 'dest_branch_id', 'delivery_zone', 'last_mile_fee',
  'rider_id', 'assigned_at', 'accepted_at', 'picked_up_at',
  'out_for_delivery_at', 'delivery_failed_at', 'delivered_by',
  'delivery_proof_image', 'pod_photo_url', 'pod_signature_url',
  'recipient_name', 'delivery_lat', 'delivery_lng', 'delivery_accuracy',
  'delivery_distance_m', 'gps_verified', 'cod_collected_amount',
  'fail_reason', 'fail_note', 'next_attempt_date', 'actual_weight',
  'intake_photos',
]);

export class WorkflowError extends Error {
  constructor(message, statusCode = 400, code = 'INVALID_TRANSITION') {
    super(message);
    this.name = 'WorkflowError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function buildUpdate(updates, toStatus) {
  const clauses = ['status=?', 'updated_at=NOW()'];
  const values = [toStatus];

  for (const [column, value] of Object.entries(updates || {})) {
    if (!UPDATE_COLUMNS.has(column)) {
      throw new WorkflowError(`Unsupported order update column: ${column}`, 500, 'UNSAFE_UPDATE');
    }
    clauses.push(`${column}=?`);
    values.push(value);
  }

  if (toStatus === 'DELIVERED') clauses.push('delivered_at=NOW()');
  if (toStatus === 'OUT_FOR_DELIVERY') clauses.push('out_for_delivery_at=NOW()');
  if (toStatus === 'DELIVERY_FAILED') clauses.push('delivery_failed_at=NOW()');

  return { clauses, values };
}

export async function transitionOrder({
  orderId,
  toStatus,
  userId = null,
  note = null,
  source = 'SYSTEM',
  updates = {},
  connection = null,
  allowSame = false,
  force = false,
  validate = null,
  afterTransition = null,
  notify = true,
}) {
  const conn = connection || await pool.getConnection();
  const ownsTransaction = !connection;

  try {
    if (ownsTransaction) await conn.beginTransaction();
    const [[order]] = await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE', [orderId]);
    if (!order) throw new WorkflowError('Order not found', 404, 'ORDER_NOT_FOUND');

    const fromStatus = resolveStatus(order.status);
    const normalizedTo = resolveStatus(toStatus);
    if (typeof validate === 'function') await validate(order, conn);

    if (fromStatus === normalizedTo && allowSame) {
      if (ownsTransaction) await conn.commit();
      return { order, fromStatus, toStatus: normalizedTo, changed: false };
    }
    if (!force && !canTransitionOrder(order.status, normalizedTo)) {
      throw new WorkflowError(
        `Cannot transition order ${order.job_no} from ${order.status} to ${normalizedTo}`,
        409
      );
    }

    const { clauses, values } = buildUpdate(updates, normalizedTo);
    values.push(orderId, order.status);
    const [updateResult] = await conn.query(
      `UPDATE orders SET ${clauses.join(', ')} WHERE id=? AND status=?`,
      values
    );
    if (updateResult.affectedRows !== 1) {
      throw new WorkflowError('Order status changed by another user; please scan again', 409, 'STALE_ORDER');
    }

    const [logResult] = await conn.query(
      `INSERT INTO order_status_logs
         (order_id, from_status, to_status, note, action_by, action_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [orderId, order.status, normalizedTo, note || `[${source}]`, userId]
    );

    if (typeof afterTransition === 'function') {
      await afterTransition(conn, order, normalizedTo);
    }

    if (notify) {
      await enqueueOrderNotification(conn, {
        orderId,
        status: normalizedTo,
        eventKey: `ORDER_STATUS_LOG:${logResult.insertId}`,
        source,
      });
    }

    if (ownsTransaction) await conn.commit();
    if (notify && ownsTransaction) kickNotificationWorker(orderId);
    return { order, fromStatus, toStatus: normalizedTo, changed: true, logId: logResult.insertId };
  } catch (error) {
    if (ownsTransaction) await conn.rollback();
    throw error;
  } finally {
    if (ownsTransaction) conn.release();
  }
}

export async function withTransaction(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
