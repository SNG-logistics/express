/**
 * src/services/riderDispatchService.js
 * Rider job broadcast & claim (first-come-first-served).
 *
 * Flow:
 *   broadcastOffer(orderId)  → create OPEN offer + recipient rows + enqueue WA offers
 *   claimOffer(id|code, uid) → atomic winner selection, assign order to that rider
 *   expireStaleOffers()      → close timed-out offers + notify the branch
 *
 * Reuses the durable customer_notification_outbox (WhatsApp, retry/idempotency)
 * via enqueueRiderNotification in notificationService.js.
 */
import pool from '../config/db.js';
import { transitionOrder, withTransaction, WorkflowError } from './orderWorkflowService.js';
import {
  enqueueRiderNotification,
  kickNotificationWorker,
} from './notificationService.js';
import { offerMessage, wonMessage, takenMessage, expiredMessage } from './riderOfferMessages.js';

const DEFAULT_EXPIRE_MIN = 15;
// Unambiguous alphabet (no O/0/I/1) for claim codes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genClaimCode(len = 4) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

// ── Broadcast ─────────────────────────────────────────────────────────────────
/**
 * Open a job to every active rider scoped to the order's destination:
 * riders of that exact branch when `dest_branch_id` is set, or HQ riders
 * (`riders.branch_id IS NULL`) when the order never left the main warehouse.
 * Idempotent: if an OPEN offer already exists for the order, returns it.
 * @returns {Promise<{ok:boolean, offerId?:number, claimCode?:string, riderCount?:number, reason?:string, already?:boolean}>}
 */
export async function broadcastOffer(orderId, { createdBy = null, expiresMin = DEFAULT_EXPIRE_MIN } = {}) {
  const result = await withTransaction(async (conn) => {
    const [[order]] = await conn.query(
      `SELECT o.id, o.job_no, o.cod_amount, o.last_mile_fee, o.dest_branch_id,
              c.name AS receiver_name, c.address AS receiver_address,
              b.name AS branch_name
       FROM orders o
       LEFT JOIN customers c ON c.id = o.receiver_id
       LEFT JOIN branches  b ON b.id = o.dest_branch_id
       WHERE o.id = ? FOR UPDATE`,
      [orderId]
    );
    if (!order) throw new WorkflowError('Order not found', 404);
    const isHq = !order.dest_branch_id;

    const [[existing]] = await conn.query(
      "SELECT id, claim_code FROM delivery_offers WHERE order_id=? AND status='OPEN' LIMIT 1",
      [orderId]
    );
    if (existing) return { ok: true, offerId: existing.id, claimCode: existing.claim_code, already: true };

    const [riders] = await conn.query(
      `SELECT r.user_id, r.phone, u.name
       FROM riders r JOIN users u ON u.id = r.user_id
       WHERE ${isHq ? 'r.branch_id IS NULL' : 'r.branch_id=?'}
         AND r.status='active' AND u.status='active' AND r.user_id IS NOT NULL`,
      isHq ? [] : [order.dest_branch_id]
    );
    if (!riders.length) return { ok: false, reason: 'NO_RIDERS', branchId: order.dest_branch_id };

    const claimCode = genClaimCode();
    const expiresAt = new Date(Date.now() + expiresMin * 60000);
    const [ins] = await conn.query(
      `INSERT INTO delivery_offers (order_id, branch_id, status, claim_code, expires_at, created_by)
       VALUES (?, ?, 'OPEN', ?, ?, ?)`,
      [orderId, order.dest_branch_id || null, claimCode, expiresAt, createdBy]
    );
    const offerId = ins.insertId;

    for (const rd of riders) {
      await conn.query(
        `INSERT IGNORE INTO delivery_offer_recipients
           (offer_id, rider_user_id, phone, channel, notified_at)
         VALUES (?, ?, ?, 'WHATSAPP', NOW())`,
        [offerId, rd.user_id, rd.phone || null]
      );
      if (rd.phone) {
        await enqueueRiderNotification(conn, {
          orderId,
          eventType: `RIDER_OFFER:${offerId}`,
          eventKey: `RIDER_OFFER:${offerId}:${rd.user_id}`,
          recipient: rd.phone,
          payload: {
            offerId, claimCode, expiresMin,
            jobNo: order.job_no,
            receiverName: order.receiver_name,
            address: order.receiver_address,
            codAmount: order.cod_amount,
            fee: order.last_mile_fee,
            branchName: order.branch_name || 'คลังใหญ่',
          },
        });
      }
    }
    return { ok: true, offerId, claimCode, riderCount: riders.length, expiresAt };
  });

  if (result.ok && !result.already) kickNotificationWorker(orderId);
  return result;
}

/** Fire-and-forget auto-broadcast used when an order reaches BRANCH_RECEIVED. */
export async function autoBroadcastOnBranchReceived(orderId) {
  try {
    const r = await broadcastOffer(orderId, { createdBy: null });
    if (!r.ok) console.log(`[RiderDispatch] auto-broadcast order=${orderId} skipped: ${r.reason}`);
    else console.log(`[RiderDispatch] auto-broadcast order=${orderId} → offer=${r.offerId} riders=${r.riderCount ?? '(existing)'}`);
  } catch (e) {
    console.error(`[RiderDispatch] auto-broadcast order=${orderId} failed:`, e.message);
  }
}

/**
 * Fire-and-forget auto-broadcast used when an order reaches AT_DEST_WH —
 * i.e. the parcel has just come off the truck. It goes to whoever is actually
 * holding the goods, so last-mile dispatch never depends on a staff member
 * remembering to open the job by hand:
 *
 *  - no destination branch (dest_branch_id NULL) — the parcel sits at the main
 *    warehouse, so offer it to HQ riders (riders.branch_id IS NULL);
 *  - a branch unloaded it off the truck itself (branch_deliveries.received_at
 *    stamped by takeBranchCustody) — offer it to that branch's riders now;
 *    the box is physically there, so there is nothing left to wait for.
 *
 * A branch-bound order that the main warehouse still holds is a no-op here: it
 * has yet to travel to the branch, and gets its own broadcast on arrival via
 * the BRANCH_RECEIVED hook.
 */
export async function autoBroadcastOnDestinationArrival(orderId) {
  try {
    const [[order]] = await pool.query('SELECT dest_branch_id FROM orders WHERE id=?', [orderId]);
    if (!order) return;
    let scope = 'HQ';
    if (order.dest_branch_id) {
      const [[held]] = await pool.query(
        'SELECT received_at FROM branch_deliveries WHERE order_id=? AND branch_id=?',
        [orderId, order.dest_branch_id]
      );
      // Routed to a branch but not yet in its hands — wait for BRANCH_RECEIVED.
      if (!held?.received_at) return;
      scope = `branch=${order.dest_branch_id}`;
    }
    const r = await broadcastOffer(orderId, { createdBy: null });
    if (!r.ok) console.log(`[RiderDispatch] ${scope} auto-broadcast order=${orderId} skipped: ${r.reason}`);
    else console.log(`[RiderDispatch] ${scope} auto-broadcast order=${orderId} → offer=${r.offerId} riders=${r.riderCount ?? '(existing)'}`);
  } catch (e) {
    console.error(`[RiderDispatch] destination auto-broadcast order=${orderId} failed:`, e.message);
  }
}

// ── Claim ───────────────────────────────────────────────────────────────────
/**
 * Attempt to claim an offer. First writer wins via a conditional UPDATE.
 * @param {number|string} offerRef  offer id (SYSTEM) — resolve code first for WhatsApp
 * @param {number} riderUserId      users.id of the claiming rider
 * @param {'SYSTEM'|'WHATSAPP'} source
 * @returns {Promise<{won:boolean, reason?:string, offerId?:number, orderId?:number, jobNo?:string}>}
 */
export async function claimOffer(offerId, riderUserId, source = 'SYSTEM') {
  const outcome = await withTransaction(async (conn) => {
    const [[offer]] = await conn.query('SELECT * FROM delivery_offers WHERE id=? FOR UPDATE', [offerId]);
    if (!offer) throw new WorkflowError('ไม่พบงานนี้', 404);
    if (offer.status !== 'OPEN') return { won: false, reason: 'TAKEN', offer };
    if (offer.expires_at && new Date(offer.expires_at) < new Date()) {
      await conn.query("UPDATE delivery_offers SET status='EXPIRED' WHERE id=? AND status='OPEN'", [offerId]);
      return { won: false, reason: 'EXPIRED', offer };
    }

    const [[riderRow]] = await conn.query(
      "SELECT id, branch_id, user_id FROM riders WHERE user_id=? AND status='active' FOR UPDATE",
      [riderUserId]
    );
    if (!riderRow) throw new WorkflowError('ไม่พบบัญชีไรเดอร์ที่ใช้งานอยู่', 403);

    const [[recipient]] = await conn.query(
      'SELECT id FROM delivery_offer_recipients WHERE offer_id=? AND rider_user_id=?',
      [offerId, riderUserId]
    );
    if (!recipient && String(riderRow.branch_id) !== String(offer.branch_id)) {
      throw new WorkflowError('งานนี้ไม่ได้เสนอให้คุณ', 403);
    }

    // Atomic winner selection — only one UPDATE can flip OPEN → CLAIMED.
    const [claim] = await conn.query(
      "UPDATE delivery_offers SET status='CLAIMED', claimed_by=?, claimed_at=NOW() WHERE id=? AND status='OPEN'",
      [riderUserId, offerId]
    );
    if (claim.affectedRows !== 1) return { won: false, reason: 'TAKEN', offer };

    await conn.query(
      "UPDATE delivery_offer_recipients SET responded_at=NOW(), response='CLAIMED' WHERE offer_id=? AND rider_user_id=?",
      [offerId, riderUserId]
    );
    // Mirror the manual assign flow: branch_delivery → ASSIGNED, rider → busy.
    await conn.query(
      "UPDATE branch_deliveries SET rider_id=?, status='ASSIGNED', assigned_at=NOW() WHERE order_id=? AND status='PENDING'",
      [riderRow.id, offer.order_id]
    );
    await conn.query("UPDATE riders SET status='busy' WHERE id=?", [riderRow.id]);
    await transitionOrder({
      orderId: offer.order_id,
      toStatus: 'RIDER_ASSIGNED',
      userId: riderUserId,
      note: `Rider claimed job (${source})`,
      source: `RIDER_CLAIM_${source}`,
      updates: { rider_id: riderUserId, assigned_at: new Date() },
      connection: conn,
    });

    return { won: true, offer };
  });

  if (outcome.won) {
    await notifyOfferResult(outcome.offer.id);
    return { won: true, offerId: outcome.offer.id, orderId: outcome.offer.order_id };
  }
  return {
    won: false,
    reason: outcome.reason,
    offerId: outcome.offer?.id,
    orderId: outcome.offer?.order_id,
  };
}

/** Resolve an OPEN offer by claim code (used by the WhatsApp reply path). */
export async function findOpenOfferByCode(claimCode) {
  const [[offer]] = await pool.query(
    "SELECT * FROM delivery_offers WHERE claim_code=? AND status='OPEN' AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY id DESC LIMIT 1",
    [String(claimCode).toUpperCase()]
  );
  return offer || null;
}

// ── Notifications ─────────────────────────────────────────────────────────────
/** Enqueue WON/TAKEN result messages to every recipient of a claimed offer. */
export async function notifyOfferResult(offerId) {
  const [[offer]] = await pool.query(
    `SELECT do.*, o.job_no, c.name AS receiver_name, c.address AS receiver_address
     FROM delivery_offers do
     JOIN orders o ON o.id = do.order_id
     LEFT JOIN customers c ON c.id = o.receiver_id
     WHERE do.id=?`,
    [offerId]
  );
  if (!offer) return;

  const [recips] = await pool.query(
    `SELECT dor.rider_user_id, dor.phone, u.name
     FROM delivery_offer_recipients dor
     JOIN users u ON u.id = dor.rider_user_id
     WHERE dor.offer_id=?`,
    [offerId]
  );
  const [[winner]] = await pool.query('SELECT name FROM users WHERE id=?', [offer.claimed_by]);

  for (const r of recips) {
    if (!r.phone) continue;
    const isWinner = String(r.rider_user_id) === String(offer.claimed_by);
    await enqueueRiderNotification(pool, {
      orderId: offer.order_id,
      eventType: `RIDER_OFFER_RESULT:${offerId}`,
      eventKey: `RIDER_OFFER_RESULT:${offerId}:${r.rider_user_id}`,
      recipient: r.phone,
      payload: {
        result: isWinner ? 'WON' : 'TAKEN',
        jobNo: offer.job_no,
        receiverName: offer.receiver_name,
        address: offer.receiver_address,
        winnerName: winner?.name || null,
      },
    });
  }
  kickNotificationWorker(offer.order_id);
}

// ── Expiry / escalation ───────────────────────────────────────────────────────
/** Close timed-out OPEN offers and notify each branch to assign manually. */
export async function expireStaleOffers() {
  const [stale] = await pool.query(
    `SELECT do.id, do.order_id, do.branch_id, o.job_no, b.phone AS branch_phone
     FROM delivery_offers do
     JOIN orders o ON o.id = do.order_id
     LEFT JOIN branches b ON b.id = do.branch_id
     WHERE do.status='OPEN' AND do.expires_at IS NOT NULL AND do.expires_at < NOW()
     LIMIT 50`
  );
  let expired = 0;
  for (const o of stale) {
    const [u] = await pool.query(
      "UPDATE delivery_offers SET status='EXPIRED' WHERE id=? AND status='OPEN'",
      [o.id]
    );
    if (u.affectedRows !== 1) continue;
    expired++;
    if (o.branch_phone) {
      await enqueueRiderNotification(pool, {
        orderId: o.order_id,
        eventType: `RIDER_OFFER_EXPIRED:${o.id}`,
        eventKey: `RIDER_OFFER_EXPIRED:${o.id}`,
        recipient: o.branch_phone,
        payload: { result: 'EXPIRED', jobNo: o.job_no },
      });
      kickNotificationWorker(o.order_id);
    }
  }
  return expired;
}

// ── Outbox send handler (called by the notification worker) ────────────────────
/** Turn a RIDER_OFFER* outbox row into an actual WhatsApp send. */
export async function sendRiderNotification(row) {
  const payload = typeof row.payload === 'string'
    ? JSON.parse(row.payload || '{}')
    : (row.payload || {});
  let text;
  if (row.event_type.startsWith('RIDER_OFFER_RESULT')) {
    text = payload.result === 'WON' ? wonMessage(payload) : takenMessage(payload);
  } else if (row.event_type.startsWith('RIDER_OFFER_EXPIRED')) {
    text = expiredMessage(payload);
  } else {
    text = offerMessage(payload);
  }
  if (!row.recipient) return { skipped: true, reason: 'no recipient' };
  const { sendTextMessage } = await import('./whatsappService.js');
  return sendTextMessage(row.recipient, text);
}

// ── WhatsApp reply → claim (called by waToCrmBridge before CRM ingest) ──────────
const ACCEPT_KEYWORDS = ['รับงาน', 'รับ', 'เอา', 'ao', 'ok', 'okay', 'yes', 'claim', 'เอางาน'];

/**
 * Try to interpret an inbound WhatsApp message as a job claim.
 * Returns { handled:true } if the message was a claim attempt (so the bridge
 * should NOT forward it to the CRM inbox), otherwise { handled:false }.
 */
export async function tryClaimFromWhatsApp(phoneRaw, text) {
  if (!text || !phoneRaw) return { handled: false };
  const { toWaPhone } = await import('../utils/waPhone.js');
  const inbound = toWaPhone(phoneRaw);
  if (!inbound) return { handled: false };

  // Candidate OPEN offers for this rider (matched by normalised phone).
  const [candidates] = await pool.query(
    `SELECT do.id AS offer_id, do.claim_code, dor.rider_user_id, dor.phone
     FROM delivery_offer_recipients dor
     JOIN delivery_offers do ON do.id = dor.offer_id
     WHERE do.status='OPEN' AND (do.expires_at IS NULL OR do.expires_at > NOW())`
  );
  const mine = candidates.filter(c => toWaPhone(c.phone) === inbound);
  if (!mine.length) return { handled: false };

  const upper = String(text).toUpperCase();
  const cleaned = upper.replace(/[^A-Z0-9฀-๿ ]/g, ' ');
  // 1) explicit claim code match
  let target = mine.find(c => cleaned.includes(String(c.claim_code).toUpperCase()));
  // 2) accept keyword + exactly one open offer for this rider
  if (!target && mine.length === 1) {
    const lower = String(text).toLowerCase();
    if (ACCEPT_KEYWORDS.some(k => lower.includes(k))) target = mine[0];
  }
  if (!target) return { handled: false };

  try {
    const res = await claimOffer(target.offer_id, target.rider_user_id, 'WHATSAPP');
    if (!res.won) {
      // Losing claim attempt still counts as handled (don't pollute CRM), and
      // the notifyOfferResult TAKEN message already tells the rider it's gone.
      const { sendTextMessage } = await import('./whatsappService.js');
      await sendTextMessage(phoneRaw, 'ℹ️ งานนี้ถูกไรเดอร์ท่านอื่นรับไปแล้ว หรือหมดเวลาแล้ว').catch(() => {});
    }
    return { handled: true, won: res.won };
  } catch (e) {
    console.error('[RiderDispatch] tryClaimFromWhatsApp failed:', e.message);
    return { handled: true, error: e.message };
  }
}
