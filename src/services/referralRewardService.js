/**
 * src/services/referralRewardService.js
 *
 * Grants the "give one, get one" referral reward when a referred member's
 * FIRST order reaches DELIVERED. Called from orderWorkflowService.transitionOrder()
 * on every DELIVERED transition, using the transition's own connection so the
 * reward insert commits (or rolls back) atomically with the delivery itself.
 *
 * maybeGrantReferralReward() never throws — a failure here must never block
 * order delivery (see orderWorkflowService.js for why this can't be the usual
 * post-commit fire-and-forget pattern).
 */
import pool from '../config/db.js';
import { getCompanySettings } from './companySettingsService.js';
import { enqueueReferralRewardNotification } from './notificationService.js';

export async function maybeGrantReferralReward(conn, order) {
  try {
    const legacyIds = [...new Set([order.sender_id, order.receiver_id].filter(Boolean))];
    if (!legacyIds.length) return;

    // Resolve via legacy_customer_id ONLY -- never a fresh phone-matching
    // scheme (memberLinkService.findSoleCustomerMatch / otpService's
    // auto-link hook already own that decision at OTP-verify time).
    const placeholders = legacyIds.map(() => '?').join(',');
    const [candidates] = await conn.query(
      `SELECT ca.id AS account_id, ca.referred_by_account_id
       FROM customer_accounts ca
       WHERE ca.legacy_customer_id IN (${placeholders})
         AND ca.referred_by_account_id IS NOT NULL
         AND ca.status = 'active'`,
      legacyIds
    );
    if (!candidates.length) return;

    const settings = await getCompanySettings();
    const referrerAmount = Number(settings.referral_reward_referrer_lak || 0);
    const referredAmount = Number(settings.referral_reward_referred_lak || 0);

    for (const candidate of candidates) {
      await grantOnePair(conn, {
        referredAccountId: candidate.account_id,
        referrerAccountId: candidate.referred_by_account_id,
        orderId: order.id,
        referrerAmount,
        referredAmount,
      });
    }
  } catch (err) {
    console.error('[ReferralReward] maybeGrantReferralReward failed:', err.message);
  }
}

async function grantOnePair(conn, { referredAccountId, referrerAccountId, orderId, referrerAmount, referredAmount }) {
  // Referrer must still be a real, non-disabled account.
  const [[referrer]] = await conn.query(
    `SELECT id, status FROM customer_accounts WHERE id = ?`,
    [referrerAccountId]
  );
  if (!referrer || referrer.status === 'disabled') return;

  let referredRewardId;
  let referrerRewardId;
  try {
    const [insReferred] = await conn.query(
      `INSERT INTO referral_reward_events
         (referred_account_id, referrer_account_id, beneficiary_account_id, role, triggering_order_id, amount_lak, status)
       VALUES (?, ?, ?, 'referred', ?, ?, 'granted')`,
      [referredAccountId, referrerAccountId, referredAccountId, orderId, referredAmount]
    );
    referredRewardId = insReferred.insertId;

    const [insReferrer] = await conn.query(
      `INSERT INTO referral_reward_events
         (referred_account_id, referrer_account_id, beneficiary_account_id, role, triggering_order_id, amount_lak, status)
       VALUES (?, ?, ?, 'referrer', ?, ?, 'granted')`,
      [referredAccountId, referrerAccountId, referrerAccountId, orderId, referrerAmount]
    );
    referrerRewardId = insReferrer.insertId;
  } catch (err) {
    // uq_rre_referred_once is the real idempotency guarantee -- this is the
    // expected outcome when another (possibly racing) DELIVERED transition
    // already granted this referred member's reward, not an error.
    if (err.code === 'ER_DUP_ENTRY' && err.message.includes('uq_rre_referred_once')) return;
    throw err;
  }

  // Enqueue notifications in the SAME transaction (atomic with the grant --
  // same pattern as enqueueOrderNotification inside transitionOrder itself).
  // Actually sending happens later via the existing outbox worker.
  await enqueueReferralRewardNotification(conn, {
    rewardId: referredRewardId,
    eventType: 'REFERRAL_REWARD:REFERRED_CREDIT',
    eventKey: `REFERRAL_REWARD:REFERRED_CREDIT:${referredRewardId}`,
  });
  await enqueueReferralRewardNotification(conn, {
    rewardId: referrerRewardId,
    eventType: 'REFERRAL_REWARD:REFERRER_CREDIT',
    eventKey: `REFERRAL_REWARD:REFERRER_CREDIT:${referrerRewardId}`,
  });
}

/**
 * Single source of truth for "what does this member have outstanding" --
 * reused by memberController.profile() (sum only) and
 * customersController.showEdit() (full list), same philosophy as
 * customersController.resolveMemberLinkState()'s own docstring.
 */
export async function getUnredeemedRewards(accountId, conn = pool) {
  try {
    const [rows] = await conn.query(
      `SELECT rre.id, rre.role, rre.amount_lak, rre.granted_at,
              o.job_no AS triggering_job_no
       FROM referral_reward_events rre
       LEFT JOIN orders o ON o.id = rre.triggering_order_id
       WHERE rre.beneficiary_account_id = ? AND rre.status = 'granted'
       ORDER BY rre.granted_at DESC`,
      [accountId]
    );
    return rows;
  } catch (err) {
    // Renders as "no credit yet" instead of a broken page during a staged
    // deploy where this migration hasn't run yet -- matches
    // companySettingsService.getCompanySettings()'s own ER_NO_SUCH_TABLE guard.
    if (err.code === 'ER_NO_SUCH_TABLE') return [];
    throw err;
  }
}
