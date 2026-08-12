import pool from '../config/db.js';

export const CUSTOMER_NOTIFICATION_STATUSES = new Set([
  'RECEIVED_WH_TH',
  'RECEIVED_WH_LA',
  'ON_TRUCK',
  'CROSSING_BORDER',
  'ARRIVED_BORDER_WH',
  'AT_DEST_WH',
  'BRANCH_TRANSFER',
  'BRANCH_RECEIVED',
  'RIDER_ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RETURN_TO_SENDER',
  'SCREENING_CUSTOMS_REQUIRED',
  'SCREENING_REJECTED',
]);

let workerTimer = null;
let workerRunning = false;

export async function requeueFailedNotifications(connection = pool) {
  const [result] = await connection.query(
    `UPDATE customer_notification_outbox
     SET status='PENDING', attempts=0, next_attempt_at=NOW(),
         last_error=CONCAT('Manually requeued: ', COALESCE(last_error, ''))
     WHERE status='FAILED'`
  );
  return result.affectedRows;
}

export async function enqueueOrderNotification(conn, {
  orderId,
  status,
  eventKey,
  source = 'SYSTEM',
}) {
  if (!CUSTOMER_NOTIFICATION_STATUSES.has(status)) return null;

  const [result] = await conn.query(
    `INSERT IGNORE INTO customer_notification_outbox
       (event_key, order_id, channel, event_type, status, payload, next_attempt_at)
     VALUES (?, ?, 'WHATSAPP', ?, 'PENDING', ?, NOW())`,
    [eventKey, orderId, `ORDER_STATUS:${status}`, JSON.stringify({ status, source })]
  );
  return result.insertId || null;
}

/**
 * Enqueue a rider-facing WhatsApp message (job offer / result / expiry).
 * Unlike customer notifications, the recipient phone + full payload are stored
 * on the row because each rider gets a distinct message.
 */
export async function enqueueRiderNotification(conn, {
  orderId,
  eventType,
  eventKey,
  recipient,
  payload = {},
}) {
  const [result] = await conn.query(
    `INSERT IGNORE INTO customer_notification_outbox
       (event_key, order_id, channel, event_type, status, recipient, payload, next_attempt_at)
     VALUES (?, ?, 'WHATSAPP', ?, 'PENDING', ?, ?, NOW())`,
    [eventKey, orderId, eventType, recipient || null, JSON.stringify(payload)]
  );
  return result.insertId || null;
}

async function markSent(id, recipient = null) {
  await pool.query(
    `UPDATE customer_notification_outbox
     SET status='SENT', recipient=?, sent_at=NOW(), last_error=NULL
     WHERE id=?`,
    [recipient, id]
  );
}

async function markSkipped(id, reason) {
  await pool.query(
    `UPDATE customer_notification_outbox
     SET status='SKIPPED', last_error=?
     WHERE id=?`,
    [String(reason || 'No message configured').slice(0, 1000), id]
  );
}

async function markFailed(id, attempts, error) {
  const delayMinutes = Math.min(60, Math.max(1, 2 ** Math.min(attempts, 5)));
  await pool.query(
    `UPDATE customer_notification_outbox
     SET status=IF(attempts >= max_attempts, 'FAILED', 'PENDING'),
         last_error=?, next_attempt_at=DATE_ADD(NOW(), INTERVAL ? MINUTE)
     WHERE id=?`,
    [String(error?.message || error || 'Unknown notification error').slice(0, 1000), delayMinutes, id]
  );
}

async function claimNotification(id) {
  const [result] = await pool.query(
    `UPDATE customer_notification_outbox
     SET status='SENDING', attempts=attempts+1
     WHERE id=? AND status IN ('PENDING','FAILED') AND attempts < max_attempts`,
    [id]
  );
  return result.affectedRows === 1;
}

export async function dispatchPendingNotifications({ orderId = null, limit = 20 } = {}) {
  if (workerRunning) return { processed: 0, busy: true };
  workerRunning = true;
  let processed = 0;

  try {
    await pool.query(
      `UPDATE customer_notification_outbox
       SET status='PENDING', next_attempt_at=NOW(), last_error='Recovered stale SENDING job'
       WHERE status='SENDING' AND updated_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)`
    );
    const params = [];
    const orderFilter = orderId ? 'AND order_id=?' : '';
    if (orderId) params.push(orderId);
    params.push(Math.max(1, Math.min(Number(limit) || 20, 100)));

    const [rows] = await pool.query(
      `SELECT id, order_id, event_type, attempts, recipient, payload
       FROM customer_notification_outbox
       WHERE status IN ('PENDING','FAILED')
         AND attempts < max_attempts
         AND next_attempt_at <= NOW()
         ${orderFilter}
       ORDER BY id ASC
       LIMIT ?`,
      params
    );

    for (const row of rows) {
      if (!await claimNotification(row.id)) continue;
      processed++;
      try {
        let result;
        if (row.event_type.startsWith('RIDER_OFFER')) {
          // Rider job offer / result / expiry — sent to the phone on the row.
          const { sendRiderNotification } = await import('./riderDispatchService.js');
          result = await sendRiderNotification(row);
        } else {
          const status = row.event_type.replace('ORDER_STATUS:', '');
          const { sendOrderUpdate } = await import('./whatsappService.js');
          result = await sendOrderUpdate(row.order_id, status);
        }
        if (result?.skipped) await markSkipped(row.id, result.reason);
        else await markSent(row.id, result?.recipient || null);
      } catch (error) {
        await markFailed(row.id, Number(row.attempts) + 1, error);
        console.error(`[Notification] order=${row.order_id} failed:`, error.message);
      }
    }

    return { processed, busy: false };
  } catch (error) {
    // Keep logistics operations available during a staged deployment where the
    // outbox migration has not been applied yet, but make the problem visible.
    if (error.code === 'ER_NO_SUCH_TABLE') {
      console.error('[Notification] customer_notification_outbox is missing; run npm run migrate-db');
      return { processed: 0, missingTable: true };
    }
    throw error;
  } finally {
    workerRunning = false;
  }
}

export function kickNotificationWorker(orderId = null) {
  setImmediate(() => {
    dispatchPendingNotifications({ orderId }).catch(error => {
      console.error('[Notification] immediate dispatch failed:', error.message);
    });
  });
}

export function startNotificationWorker(intervalMs = 30_000) {
  if (workerTimer) return workerTimer;
  workerTimer = setInterval(() => {
    dispatchPendingNotifications().catch(error => {
      console.error('[Notification] worker failed:', error.message);
    });
    // Expire timed-out rider job offers and escalate to the branch.
    import('./riderDispatchService.js')
      .then(m => m.expireStaleOffers())
      .catch(error => console.error('[Notification] offer expiry failed:', error.message));
  }, intervalMs);
  workerTimer.unref?.();
  return workerTimer;
}

export function stopNotificationWorker() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}
