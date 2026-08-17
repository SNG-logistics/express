-- ═══════════════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 029: Partner Quotations Schema Reconciliation
-- ═══════════════════════════════════════════════════════════════════════
-- partner_quotations was defined in two places that drifted:
--   src/app.js initDb()      → quote_no VARCHAR(30), NO uniqueness, product_name NOT NULL
--   migrate_007_production_sync.sql → quote_no VARCHAR(50) UNIQUE, product_name nullable
-- This migration converges to the STRICTER of the two definitions:
--   quote_no VARCHAR(50) NOT NULL UNIQUE
--   product_name VARCHAR(500) NOT NULL
-- Duplicate quote_no values are deduped before the UNIQUE constraint is
-- added (real risk — the original genQuoteNo() used COUNT(*)+1, which is
-- not atomic under concurrent staff use).
-- Safe to run multiple times (INFORMATION_SCHEMA + PREPARE/EXECUTE guards).
-- Written to be compatible with MySQL 5.7+ (no window functions).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Widen quote_no to VARCHAR(50) if it is still VARCHAR(30) ──────────────
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE()
             AND table_name = 'partner_quotations'
             AND column_name = 'quote_no'
             AND character_maximum_length < 50);
SET @s := IF(@c > 0,
  'ALTER TABLE partner_quotations MODIFY COLUMN quote_no VARCHAR(50) NOT NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 2. Deduplicate existing duplicate quote_no values ────────────────────────
-- Keep the LOWEST id for each quote_no; suffix the rest with a stable
-- timestamp+id token so they become unique and nothing is lost.
-- Left(quote_no, 20) + '-' + YYYYMMDDHHMMSS (14) + '-' + id (≤11) = ≤47 chars,
-- safely inside the VARCHAR(50) bound.
UPDATE partner_quotations pq
LEFT JOIN partner_quotations keep
       ON keep.quote_no = pq.quote_no AND keep.id < pq.id
SET pq.quote_no = CONCAT(
      LEFT(pq.quote_no, 20),
      '-', DATE_FORMAT(pq.created_at, '%Y%m%d%H%i%s'),
      '-', pq.id)
WHERE keep.id IS NOT NULL;

-- ── 3. Normalise NULL/empty product_name to a placeholder before NOT NULL ─────
UPDATE partner_quotations
SET product_name = 'Unnamed product'
WHERE product_name IS NULL OR TRIM(product_name) = '';

-- ── 4. Assert product_name VARCHAR(500) NOT NULL ──────────────────────────────
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE()
             AND table_name = 'partner_quotations'
             AND column_name = 'product_name'
             AND (is_nullable = 'YES' OR character_maximum_length < 500));
SET @s := IF(@c > 0,
  'ALTER TABLE partner_quotations MODIFY COLUMN product_name VARCHAR(500) NOT NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 5. Add UNIQUE(quote_no) if not already present ────────────────────────────
SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE()
               AND table_name = 'partner_quotations'
               AND index_name = 'uq_pq_quote_no');
SET @s := IF(@idx = 0,
  'ALTER TABLE partner_quotations ADD UNIQUE KEY uq_pq_quote_no (quote_no)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
