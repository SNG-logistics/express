/**
 * src/services/quotationWorkflowService.js
 *
 * Guarded state transitions for purchase-agent quotations.
 * Mirrors transitionOrder() in orderWorkflowService.js — row lock,
 * transition-guard, optimistic-concurrency update, status-log insert,
 * notification enqueue — but accepts EITHER a staff userId OR a customer
 * customerId as the actor, because accept/reject is customer-initiated while
 * every other move is staff-initiated. Both funnel through this one function.
 */
import pool from '../config/db.js';
import { canTransitionQuotation } from '../constants/transitions.js';
import { WorkflowError } from './orderWorkflowService.js';
import { enqueuePurchaseAgentNotification, kickNotificationWorker } from './notificationService.js';

const TERMINAL_NOTE_PREFIX = '[PA]';

/**
 * @param {object} opts
 * @param {number} opts.quotationId
 * @param {string} opts.toStatus
 * @param {number|null} [opts.userId=null]       — staff actor (users.id)
 * @param {number|null} [opts.customerId=null]   — customer actor (customer_accounts.id)
 * @param {string|null} [opts.note=null]
 * @param {object|null} [opts.connection=null]   — existing transaction conn
 * @param {boolean} [opts.notify=true]           — enqueue a WhatsApp message
 * @returns {Promise<{ quotation, fromStatus, toStatus, changed: boolean, logId?: number }>}
 */
export async function transitionQuotation({
  quotationId,
  toStatus,
  userId = null,
  customerId = null,
  note = null,
  connection = null,
  notify = true,
  extraPayload = {},
}) {
  const conn = connection || await pool.getConnection();
  const ownsTransaction = !connection;

  if (!userId && !customerId) {
    throw new WorkflowError('Transition requires either a staff actor or a customer actor', 400, 'ACTOR_REQUIRED');
  }

  try {
    if (ownsTransaction) await conn.beginTransaction();
    const [[quotation]] = await conn.query(
      'SELECT * FROM partner_quotations WHERE id = ? FOR UPDATE',
      [quotationId]
    );
    if (!quotation) throw new WorkflowError('Quotation not found', 404, 'QUOTATION_NOT_FOUND');

    const fromStatus = quotation.status;
    if (fromStatus === toStatus) {
      if (ownsTransaction) await conn.commit();
      return { quotation, fromStatus, toStatus, changed: false };
    }
    if (!canTransitionQuotation(fromStatus, toStatus)) {
      throw new WorkflowError(
        `Cannot transition quotation ${quotation.quote_no} from ${fromStatus} to ${toStatus}`,
        409
      );
    }

    // Deposit gate: accepted → purchasing requires the deposit to be covered.
    if (toStatus === 'purchasing' && quotation.payment_status !== 'PAID') {
      throw new WorkflowError(
        `Cannot start purchasing ${quotation.quote_no}: deposit not yet paid (${quotation.payment_status})`,
        409,
        'DEPOSIT_NOT_PAID'
      );
    }

    const [updateResult] = await conn.query(
      `UPDATE partner_quotations
       SET status = ?, updated_at = NOW()
       WHERE id = ? AND status = ?`,
      [toStatus, quotationId, fromStatus]
    );
    if (updateResult.affectedRows !== 1) {
      throw new WorkflowError('Quotation status changed by another user; please refresh', 409, 'STALE_QUOTATION');
    }

    const [logResult] = await conn.query(
      `INSERT INTO partner_quotation_status_logs
         (quotation_id, from_status, to_status, note, action_by, action_by_customer_id, action_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [quotationId, fromStatus, toStatus,
        note || (customerId ? `${TERMINAL_NOTE_PREFIX} customer action` : `${TERMINAL_NOTE_PREFIX} staff action`),
        userId, customerId]
    );

    if (notify) {
      // Recipient + payload are resolved at ENQUEUE time (from the linked
      // product_quote_requests row → customer_accounts.phone) and stored on
      // the outbox row — the send worker never re-queries, exactly like the
      // RIDER_OFFER flow. The quotation has no orders row (and no direct
      // quote_request_id column); the link is product_quote_requests.
      await enqueuePurchaseAgentNotification(conn, {
        quotationId,
        eventType: `PURCHASE_AGENT:${toStatus.toUpperCase()}`,
        eventKey: `PURCHASE_AGENT:${quotation.quote_no}:${toStatus}:${logResult.insertId}`,
        // Carries per-stage detail the standard payload cannot know — the Thai
        // leg's box counts, for one, which turn "shipped" into "2 of 3 boxes".
        extraPayload,
      });
    }

    if (ownsTransaction) await conn.commit();
    if (notify && ownsTransaction) kickNotificationWorker();
    return { quotation, fromStatus, toStatus, changed: true, logId: logResult.insertId };
  } catch (error) {
    if (ownsTransaction) await conn.rollback();
    throw error;
  } finally {
    if (ownsTransaction) conn.release();
  }
}
