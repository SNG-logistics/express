-- SNG Logistics — Safe migration for local/staging/production
-- Run this ONCE against your existing database to apply missing columns and keys.
-- Safe: uses IF NOT EXISTS and column existence checks.

-- ─── 1. Add image_path to orders if missing ──────────────────────────────────
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'image_path'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE orders ADD COLUMN image_path VARCHAR(255) DEFAULT NULL AFTER status',
  'SELECT ''image_path already exists'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 2. Add UNIQUE KEY on cod_settlements.order_id if missing ─────────────────
SET @idx_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'cod_settlements'
    AND INDEX_NAME = 'uq_cod_order'
);

SET @sql2 = IF(@idx_exists = 0,
  'ALTER TABLE cod_settlements ADD UNIQUE KEY uq_cod_order (order_id)',
  'SELECT ''uq_cod_order already exists'' AS info'
);
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- ─── 3. Ensure users table has warehouse roles ────────────────────────────────
-- If your users table was created from the old schema.sql (missing warehouse roles),
-- this alters the ENUM to include them.
ALTER TABLE users
  MODIFY COLUMN role ENUM('admin','staff','manager','thai_warehouse','lao_warehouse')
  NOT NULL DEFAULT 'staff';

-- ─── 4. Ensure orders.trip_id has a FK (if missing) ──────────────────────────
SET @fk_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'orders'
    AND CONSTRAINT_NAME = 'fk_orders_trip'
);

SET @sql3 = IF(@fk_exists = 0,
  'ALTER TABLE orders ADD CONSTRAINT fk_orders_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL',
  'SELECT ''fk_orders_trip already exists'' AS info'
);
PREPARE stmt3 FROM @sql3;
EXECUTE stmt3;
DEALLOCATE PREPARE stmt3;

SELECT 'Migration complete.' AS result;
