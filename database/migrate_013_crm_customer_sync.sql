-- ═══════════════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 013: Sync customers → crm_customers
-- ═══════════════════════════════════════════════════════════════════════
-- Safe to run multiple times (INSERT IGNORE + IF NOT EXISTS guards)
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Add synced_from_legacy flag to crm_customers ─────────────────────────
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_customers' AND COLUMN_NAME='synced_from_legacy');
SET @s = IF(@c=0,
  "ALTER TABLE crm_customers ADD COLUMN synced_from_legacy TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=นำเข้าจากระบบขนส่ง' AFTER note",
  "SELECT 'crm_customers.synced_from_legacy already exists' AS info");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── 2. Add last_synced_at timestamp ─────────────────────────────────────────
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_customers' AND COLUMN_NAME='last_synced_at');
SET @s = IF(@c=0,
  "ALTER TABLE crm_customers ADD COLUMN last_synced_at TIMESTAMP NULL DEFAULT NULL COMMENT 'เวลาที่ sync ล่าสุดจากระบบขนส่ง' AFTER synced_from_legacy",
  "SELECT 'crm_customers.last_synced_at already exists' AS info");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── 3. Ensure UNIQUE index on legacy_customer_id to prevent duplicates ───────
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_customers'
              AND INDEX_NAME='uq_crm_legacy_customer_id');
SET @s = IF(@idx=0,
  "ALTER TABLE crm_customers ADD UNIQUE KEY uq_crm_legacy_customer_id (legacy_customer_id)",
  "SELECT 'index uq_crm_legacy_customer_id already exists' AS info");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── 4. Bulk import: customers → crm_customers (INSERT IGNORE) ───────────────
-- Maps:
--   customers.id          → legacy_customer_id
--   customers.name        → full_name
--   customers.phone       → phone
--   customers.email       → email
--   customers.country     → country
--   customers.province    → province
--   customers.city        → district
--   customers.address     → address
--   type=person/shop      → customer_type=CUSTOMER
--   auto                  → customer_code='SYNC-{id}'
--   synced_from_legacy    = 1
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO crm_customers
  (legacy_customer_id, customer_code, full_name, phone, email,
   country, province, district, address,
   customer_type, preferred_language,
   synced_from_legacy, last_synced_at, created_at)
SELECT
  c.id,
  CONCAT('SYNC-', c.id),
  c.name,
  c.phone,
  c.email,
  c.country,
  c.province,
  c.city,
  c.address,
  'CUSTOMER',
  CASE
    WHEN LOWER(c.country) IN ('la','lao','laos','ลาว') THEN 'lo'
    ELSE 'th'
  END,
  1,
  NOW(),
  c.created_at
FROM customers c
WHERE c.active = 1
  AND c.id NOT IN (
    SELECT legacy_customer_id FROM crm_customers WHERE legacy_customer_id IS NOT NULL
  );

-- ─── 5. Verification ─────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM customers WHERE active=1)                              AS legacy_total,
  (SELECT COUNT(*) FROM crm_customers WHERE synced_from_legacy=1)             AS synced_count,
  (SELECT COUNT(*) FROM customers c WHERE c.active=1
     AND c.id NOT IN (
       SELECT legacy_customer_id FROM crm_customers WHERE legacy_customer_id IS NOT NULL
     ))                                                                        AS not_synced_yet;
