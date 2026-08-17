-- ═══════════════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 032: Member ↔ Legacy Customer Linkage
-- ═══════════════════════════════════════════════════════════════════════
-- Closes two gaps left over from PUBLIC_PORTAL_PLAN.md §4.2 that were
-- designed but never implemented in code:
--   1. customer_accounts.legacy_customer_id had no FK — a soft link only,
--      and nothing in src/ ever read or wrote it. Must be widened from
--      INT UNSIGNED to BIGINT UNSIGNED FIRST: InnoDB requires matching
--      integer size/sign between a FK column and the column it references
--      (customers.id is BIGINT UNSIGNED), or ADD CONSTRAINT fails (errno 150).
--   2. partner_quotations had no way to trace back to the member who filed
--      the originating product_quote_requests row — customer_name/_phone/
--      _address are plain denormalized text, never linked to
--      customer_accounts. Adds partner_quotations.customer_account_id and
--      backfills it for quotations that already exist from a request.
-- Safe to run multiple times (INFORMATION_SCHEMA + PREPARE/EXECUTE guards).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Widen customer_accounts.legacy_customer_id to BIGINT UNSIGNED ─────────
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE()
             AND table_name = 'customer_accounts'
             AND column_name = 'legacy_customer_id'
             AND data_type <> 'bigint');
SET @s := IF(@c > 0,
  'ALTER TABLE customer_accounts MODIFY COLUMN legacy_customer_id BIGINT UNSIGNED NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 2. Index + FK: customer_accounts.legacy_customer_id → customers(id) ──────
-- ON DELETE SET NULL: customers rows are only ever soft-deleted (active=0)
-- by any code path today, never hard-deleted, but SET NULL is the safe
-- default if that ever changes — a member account must never vanish just
-- because its legacy address-book row did.
SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE()
               AND table_name = 'customer_accounts'
               AND index_name = 'idx_ca_legacy_customer');
SET @s := IF(@idx = 0,
  'ALTER TABLE customer_accounts ADD KEY idx_ca_legacy_customer (legacy_customer_id)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @fk := (SELECT COUNT(*) FROM information_schema.table_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'customer_accounts'
              AND constraint_name = 'fk_ca_legacy_customer');
SET @s := IF(@fk = 0,
  'ALTER TABLE customer_accounts
     ADD CONSTRAINT fk_ca_legacy_customer FOREIGN KEY (legacy_customer_id)
       REFERENCES customers(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 3. partner_quotations.customer_account_id — nullable FK ──────────────────
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE()
             AND table_name = 'partner_quotations'
             AND column_name = 'customer_account_id');
SET @s := IF(@c = 0,
  'ALTER TABLE partner_quotations
     ADD COLUMN customer_account_id BIGINT UNSIGNED NULL AFTER created_by,
   ADD KEY idx_pq_customer_account (customer_account_id)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @fk := (SELECT COUNT(*) FROM information_schema.table_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'partner_quotations'
              AND constraint_name = 'fk_pq_customer_account');
SET @s := IF(@fk = 0,
  'ALTER TABLE partner_quotations
     ADD CONSTRAINT fk_pq_customer_account FOREIGN KEY (customer_account_id)
       REFERENCES customer_accounts(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 4. Backfill customer_account_id for quotations already linked from a
--       product_quote_requests row (created before this migration shipped) ──
UPDATE partner_quotations pq
INNER JOIN product_quote_requests pqr ON pqr.linked_quotation_id = pq.id
SET pq.customer_account_id = pqr.customer_account_id
WHERE pq.customer_account_id IS NULL;
