-- ═══════════════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 033: Member/Customer Link Integrity + Audit
-- ═══════════════════════════════════════════════════════════════════════
-- Follow-up to migrate_032 (which already ran, so it is not edited here):
--   1. The link/unlink UI and every write path treat customer_accounts.
--      legacy_customer_id as a strict 1:1 relationship (one legacy customer
--      per member account) — assert that with a real UNIQUE constraint
--      instead of only relying on application-level guards.
--   2. Add an audit trail for link/unlink actions (who did it, when, why) —
--      required for the new staff "unlink" action, and also used by "link"
--      for a complete history.
-- Safe to run multiple times (INFORMATION_SCHEMA + PREPARE/EXECUTE guards).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Refuse to add the UNIQUE constraint if duplicate legacy_customer_id
--       values already exist (NULLs are never duplicates under MySQL's
--       UNIQUE semantics, so unlinked accounts are unaffected either way).
--       This should be impossible via the app (every write path is guarded
--       by `AND legacy_customer_id IS NULL`, and customer_accounts.phone is
--       itself UNIQUE, so at most one account can ever auto-match a given
--       customers row) — but if direct DB access ever created a duplicate,
--       fail loudly by leaving the constraint off rather than silently
--       picking one row to keep.
SET @dupes := (SELECT COUNT(*) FROM (
                 SELECT legacy_customer_id FROM customer_accounts
                 WHERE legacy_customer_id IS NOT NULL
                 GROUP BY legacy_customer_id HAVING COUNT(*) > 1
               ) d);

SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE()
               AND table_name = 'customer_accounts'
               AND index_name = 'uq_ca_legacy_customer');
SET @s := IF(@idx = 0 AND @dupes = 0,
  'ALTER TABLE customer_accounts ADD UNIQUE KEY uq_ca_legacy_customer (legacy_customer_id)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Surface the problem instead of failing silently if duplicates were found —
-- a human needs to resolve which link is correct before this can be re-run.
SELECT
  CASE
    WHEN @dupes > 0 THEN CONCAT('WARNING: ', @dupes, ' duplicate legacy_customer_id value(s) found — UNIQUE constraint NOT added. Resolve manually and re-run this migration.')
    ELSE 'OK: no duplicates found.'
  END AS uq_ca_legacy_customer_status;

-- ── 2. Audit log for link/unlink actions ──────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_account_link_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  customer_account_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  action ENUM('linked', 'unlinked') NOT NULL,
  reason TEXT NULL,
  action_by BIGINT UNSIGNED NOT NULL COMMENT 'users.id — staff who performed the action',
  action_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cal_account (customer_account_id),
  KEY idx_cal_customer (customer_id),
  KEY idx_cal_action_at (action_at),
  CONSTRAINT fk_cal_account FOREIGN KEY (customer_account_id)
    REFERENCES customer_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_cal_customer FOREIGN KEY (customer_id)
    REFERENCES customers(id) ON DELETE CASCADE,
  CONSTRAINT fk_cal_staff FOREIGN KEY (action_by)
    REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Audit trail for customer_accounts.legacy_customer_id link/unlink actions';
