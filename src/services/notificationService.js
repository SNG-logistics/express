import pool from '../config/db.js';

// Customer WhatsApp notifications are intentionally limited to TWO touch-points
// so customers are not spammed at every status change:
//   ON_TRUCK   — parcel is loaded and crossing the border to the customer
//   AT_DEST_WH — parcel arrived at the destination point (branch OR main office)
export const CUSTOMER_NOTIFICATION_STATUSES = new Set([
  'ON_TRUCK',
  'AT_DEST_WH',
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

/**
 * Enqueue a purchase-agent WhatsApp notification. The recipient phone and a
 * stage payload are resolved at ENQUEUE time (quotation → linked
 * product_quote_requests → customer_accounts.phone) and stored on the row —
 * the send worker never re-queries, exactly like the RIDER_OFFER pattern.
 * Needs either a quotationId (most stages) or a quoteRequestId (stages that
 * fire before a quotation exists: REQUEST_RECEIVED, DECLINED).
 */
export async function enqueuePurchaseAgentNotification(conn, {
  quotationId = null,
  quoteRequestId = null,
  eventType,
  eventKey,
  extraPayload = {},
}) {
  if (!quotationId && !quoteRequestId) return null;

  const [[row]] = await conn.query(
    `SELECT pq.quote_no, pq.product_name, pq.desired_qty,
            pq.total_lak, pq.deposit_required_lak,
            pq.sng_shipping_lak, pq.service_fee_lak,
            pqr.id AS request_id, pqr.decline_reason, pqr.product_name AS request_product,
            pqr.desired_qty AS request_qty,
            ca.phone, ca.phone_display
     FROM partner_quotations pq
     LEFT JOIN product_quote_requests pqr ON pqr.linked_quotation_id = pq.id
     LEFT JOIN customer_accounts ca ON ca.id = pqr.customer_account_id
     WHERE pq.id = ?`,
    [quotationId || 0]
  );
  const [[reqRow]] = !quotationId
    ? await conn.query(
        `SELECT pqr.id AS request_id, pqr.product_name, pqr.desired_qty,
                pqr.decline_reason, ca.phone, ca.phone_display
         FROM product_quote_requests pqr
         LEFT JOIN customer_accounts ca ON ca.id = pqr.customer_account_id
         WHERE pqr.id = ?`,
        [quoteRequestId || 0]
      )
    : [[null, null]];

  const source = quotationId ? row : reqRow;
  if (!source) return null;
  const recipient = source.phone || source.phone_display || null;
  if (!recipient) return null;

  const payload = !quotationId ? {
    productName: source.product_name || '',
    qty: Number(source.desired_qty) || 1,
    reason: source.decline_reason || null,
  } : {
    quoteNo: row.quote_no || '',
    productName: row.product_name || '',
    qty: Number(row.desired_qty) || 1,
    productLak: Number(row.deposit_required_lak) || 0,
    depositLak: Number(row.deposit_required_lak) || 0,
    sngShippingLak: Number(row.sng_shipping_lak) || 0,
    serviceFeeLak: Number(row.service_fee_lak) || 0,
    totalLak: Number(row.total_lak) || 0,
  };

  const [result] = await conn.query(
    `INSERT IGNORE INTO customer_notification_outbox
       (event_key, order_id, quote_request_id, quotation_id, channel, event_type, status, recipient, payload, next_attempt_at)
     VALUES (?, NULL, ?, ?, 'WHATSAPP', ?, 'PENDING', ?, ?, NOW())`,
    [eventKey, quoteRequestId || null, quotationId || null, eventType, recipient, JSON.stringify({ ...payload, ...extraPayload })]
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
        } else if (row.event_type.startsWith('PURCHASE_AGENT:')) {
          // Purchase-agent stage message (Lao) — recipient + payload resolved
          // at enqueue time and stored on the row, mirroring RIDER_OFFER.
          const { sendPurchaseAgentNotification } = await import('./purchaseAgentNotificationService.js');
          result = await sendPurchaseAgentNotification(row);
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
