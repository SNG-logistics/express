-- ═══════════════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 031: company_settings Schema Reconciliation
-- ═══════════════════════════════════════════════════════════════════════
-- company_settings has only ever been created by scripts/init_company_settings.mjs
-- (CREATE TABLE IF NOT EXISTS, no versioned migration) — same class of drift
-- risk as migrate_029's partner_quotations. Production's table predates the
-- updated_by column: settings/company-profile save + logo upload both write
-- it (`INSERT ... ON DUPLICATE KEY UPDATE ... updated_by=VALUES(updated_by)`)
-- and fail there with "Unknown column 'updated_by' in 'field list'".
-- Safe to run multiple times (INFORMATION_SCHEMA + PREPARE/EXECUTE guards).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 0. Table must exist at all (covers a deployment that never ran the script) ──
CREATE TABLE IF NOT EXISTS company_settings (
  id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  setting_key VARCHAR(80) NOT NULL UNIQUE,
  setting_value TEXT NULL,
  updated_by INT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 1. Add updated_by if missing (the confirmed production error) ────────────
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE()
             AND table_name = 'company_settings'
             AND column_name = 'updated_by');
SET @s := IF(@c = 0,
  'ALTER TABLE company_settings ADD COLUMN updated_by INT UNSIGNED NULL AFTER setting_value',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 2. Add updated_at if missing (defensive — not directly referenced by name
--       in any query today, but part of the intended schema) ────────────────
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE()
             AND table_name = 'company_settings'
             AND column_name = 'updated_at');
SET @s := IF(@c = 0,
  'ALTER TABLE company_settings ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 3. Dedupe any existing duplicate setting_key rows before asserting UNIQUE ─
-- Unlike migrate_029's quote_no (independent business records worth keeping
-- under a renamed key), a settings table only ever has ONE meaningful value
-- per key — keep the highest id (most recent write) and drop the rest.
DELETE t1 FROM company_settings t1
INNER JOIN company_settings t2
  ON t1.setting_key = t2.setting_key AND t1.id < t2.id;

-- ── 4. Ensure setting_key is UNIQUE (defensive — required for every
--       `INSERT ... ON DUPLICATE KEY UPDATE` / `INSERT IGNORE` upsert used
--       against this table to behave as an upsert instead of silently
--       accumulating duplicate rows) ─────────────────────────────────────────
SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE()
               AND table_name = 'company_settings'
               AND index_name = 'setting_key');
SET @s := IF(@idx = 0,
  'ALTER TABLE company_settings ADD UNIQUE KEY setting_key (setting_key)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
