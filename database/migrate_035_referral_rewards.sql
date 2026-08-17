-- ═══════════════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 035: Referral Reward Events
-- ═══════════════════════════════════════════════════════════════════════
-- Closes PUBLIC_PORTAL_PLAN.md §7 item 6 (referral half only — general
-- points/coupons stay "coming soon", see views/customer/member/profile.ejs).
-- customer_accounts.referral_code / referred_by_account_id (migrate_025)
-- have existed since Phase 1b but nothing ever paid out a reward.
--
-- Two rows per completed referral (referrer + referred), not one combined
-- row, because staff redeem each side's credit independently at different
-- times from different customers-edit pages. beneficiary_account_id is a
-- deliberate denormalization (always equals referred_account_id or
-- referrer_account_id depending on role) so balance queries need no
-- CASE WHEN — same pattern as customer_notification_outbox.recipient.
--
-- UNIQUE KEY uq_rre_referred_once(referred_account_id, role) is the sole
-- correctness guarantee against double-granting: each member has exactly
-- one referred_by_account_id (set once, permanently, at signup), so
-- "referred friend's first successful job" can happen at most once per
-- member, ever. src/services/referralRewardService.js relies on this
-- constraint directly (attempt INSERT, catch ER_DUP_ENTRY) rather than a
-- separate SELECT-then-INSERT check, so it stays correct even when two
-- DELIVERED transitions for two different orders race on two different
-- DB connections.
--
-- Safe to run multiple times (INFORMATION_SCHEMA + PREPARE/EXECUTE guards).
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS referral_reward_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  referred_account_id BIGINT UNSIGNED NOT NULL
    COMMENT 'the referred friend whose first successful (DELIVERED) job triggered this event -- shared by both rows of a pair',
  referrer_account_id BIGINT UNSIGNED NOT NULL
    COMMENT 'referred_account_id row DOT referred_by_account_id at grant time -- shared by both rows of a pair',
  beneficiary_account_id BIGINT UNSIGNED NOT NULL
    COMMENT 'who this row credits -- equals referred_account_id when role=referred, referrer_account_id when role=referrer; denormalized so balance queries need no CASE WHEN',
  role ENUM('referrer', 'referred') NOT NULL COMMENT 'which side of the pair this row represents',
  triggering_order_id BIGINT UNSIGNED NOT NULL COMMENT 'the order whose DELIVERED transition granted this reward',
  amount_lak DECIMAL(12,2) NOT NULL
    COMMENT 'snapshot of company_settings.referral_reward_referrer_lak / referral_reward_referred_lak at grant time -- later setting changes must not retroactively change already-granted amounts',
  status ENUM('granted', 'redeemed') NOT NULL DEFAULT 'granted',
  granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  redeemed_at TIMESTAMP NULL,
  redeemed_by BIGINT UNSIGNED NULL COMMENT 'users.id -- staff who marked this credit redeemed',
  redeemed_note VARCHAR(255) NULL COMMENT 'optional staff context, e.g. which order the credit was applied to',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rre_referred_once (referred_account_id, role),
  KEY idx_rre_beneficiary_status (beneficiary_account_id, status),
  KEY idx_rre_referrer (referrer_account_id),
  KEY idx_rre_order (triggering_order_id),
  CONSTRAINT fk_rre_referred FOREIGN KEY (referred_account_id) REFERENCES customer_accounts(id),
  CONSTRAINT fk_rre_referrer FOREIGN KEY (referrer_account_id) REFERENCES customer_accounts(id),
  CONSTRAINT fk_rre_beneficiary FOREIGN KEY (beneficiary_account_id) REFERENCES customer_accounts(id),
  CONSTRAINT fk_rre_order FOREIGN KEY (triggering_order_id) REFERENCES orders(id),
  CONSTRAINT fk_rre_redeemed_by FOREIGN KEY (redeemed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Referral reward ledger -- two rows per completed referral (referrer + referred), granted once when the referred friend first order reaches DELIVERED';

-- ── customer_notification_outbox: add referral_reward_id link column ─────────
-- Mirrors migrate_030's quote_request_id/quotation_id pattern -- the send
-- worker never re-derives the reward from the order; it reads recipient +
-- payload resolved at enqueue time (notificationService.enqueueReferralRewardNotification).
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE()
             AND table_name = 'customer_notification_outbox'
             AND column_name = 'referral_reward_id');
SET @s := IF(@c = 0,
  'ALTER TABLE customer_notification_outbox
     ADD COLUMN referral_reward_id BIGINT UNSIGNED NULL AFTER quotation_id,
   ADD KEY idx_notification_referral_reward (referral_reward_id)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @fk := (SELECT COUNT(*) FROM information_schema.table_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'customer_notification_outbox'
              AND constraint_name = 'fk_notification_referral_reward');
SET @s := IF(@fk = 0,
  'ALTER TABLE customer_notification_outbox
     ADD CONSTRAINT fk_notification_referral_reward
       FOREIGN KEY (referral_reward_id) REFERENCES referral_reward_events(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
