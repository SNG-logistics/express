-- SNG Logistics — Migration 002: Workflow Enhancement Fields
-- รัน ONCE ต่อจาก migrate_001.sql
-- ทุก statement เป็น idempotent — รันซ้ำได้ปลอดภัย

-- ─── 1. orders: เพิ่มฟิลด์สำหรับ workflow ใหม่ ─────────────────────────────

-- 1a. condition — สภาพพัสดุตอนรับ
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='condition_status');
SET @s = IF(@col=0, 'ALTER TABLE orders ADD COLUMN condition_status ENUM(''good'',''damaged'',''wet'') DEFAULT ''good'' AFTER status', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1b. created_by — ใครสร้าง order
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='created_by');
SET @s = IF(@col=0, 'ALTER TABLE orders ADD COLUMN created_by BIGINT UNSIGNED NULL AFTER trip_id', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1c. delivered_at — เวลาส่งจริง
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='delivered_at');
SET @s = IF(@col=0, 'ALTER TABLE orders ADD COLUMN delivered_at TIMESTAMP NULL AFTER updated_at', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1d. delivered_by — Rider ที่ส่ง
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='delivered_by');
SET @s = IF(@col=0, 'ALTER TABLE orders ADD COLUMN delivered_by BIGINT UNSIGNED NULL AFTER delivered_at', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1e. delivery_proof_image — รูปยืนยันส่งสำเร็จ
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='delivery_proof_image');
SET @s = IF(@col=0, 'ALTER TABLE orders ADD COLUMN delivery_proof_image VARCHAR(255) NULL AFTER delivered_by', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1f. fail_reason — เหตุผลส่งไม่สำเร็จ
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='fail_reason');
SET @s = IF(@col=0, 'ALTER TABLE orders ADD COLUMN fail_reason VARCHAR(40) NULL AFTER delivery_proof_image', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1g. fail_count — จำนวนครั้งที่ส่งไม่สำเร็จ
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='fail_count');
SET @s = IF(@col=0, 'ALTER TABLE orders ADD COLUMN fail_count TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER fail_reason', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 2. INDEX ที่จำเป็น ──────────────────────────────────────────────────────

-- 2a. orders.status — query ทุกหน้า
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='idx_orders_status');
SET @s = IF(@idx=0, 'ALTER TABLE orders ADD INDEX idx_orders_status (status)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2b. orders.created_at — ORDER BY ทุกหน้า
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='idx_orders_created_at');
SET @s = IF(@idx=0, 'ALTER TABLE orders ADD INDEX idx_orders_created_at (created_at)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2c. orders.direction
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='idx_orders_direction');
SET @s = IF(@idx=0, 'ALTER TABLE orders ADD INDEX idx_orders_direction (direction)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2d. payments compound index
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payments' AND INDEX_NAME='idx_payments_order_type');
SET @s = IF(@idx=0, 'ALTER TABLE payments ADD INDEX idx_payments_order_type (order_id, type)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2e. cod_settlements.status
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cod_settlements' AND INDEX_NAME='idx_cod_status');
SET @s = IF(@idx=0, 'ALTER TABLE cod_settlements ADD INDEX idx_cod_status (status)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2f. customers active + name
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customers' AND INDEX_NAME='idx_customers_active_name');
SET @s = IF(@idx=0, 'ALTER TABLE customers ADD INDEX idx_customers_active_name (active, name)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 3. cod_settlements: เพิ่ม remit tracking ────────────────────────────────

-- 3a. เพิ่ม REMITTED value ใน status enum
ALTER TABLE cod_settlements
  MODIFY COLUMN status ENUM('PENDING','COLLECTED','REMITTED') NOT NULL DEFAULT 'PENDING';

-- 3b. remit_ref — หมายเลขอ้างอิงการโอน
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cod_settlements' AND COLUMN_NAME='remit_ref');
SET @s = IF(@col=0, 'ALTER TABLE cod_settlements ADD COLUMN remit_ref VARCHAR(120) NULL AFTER remitted_to', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 4. Migrate legacy status values ─────────────────────────────────────────
-- แปลง status เดิมเป็นชื่อใหม่ (ถ้ามี)
UPDATE orders SET status = 'ON_TRUCK'          WHERE status = 'ON_TRUCK_BORDER';
UPDATE orders SET status = 'CUSTOMS_HOLD'      WHERE status = 'CUSTOMS_CLEARANCE';
UPDATE orders SET status = 'CUSTOMS_CLEARED'   WHERE status = 'CLEARED';
UPDATE orders SET status = 'DELIVERY_FAILED'   WHERE status = 'FAILED';
UPDATE orders SET status = 'RETURN_TO_SENDER'  WHERE status = 'RETURNED';

SELECT 'Migration 002 complete.' AS result;
