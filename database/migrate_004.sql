-- ═══════════════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 004: Phase 1-2 Operational Workflow
-- Safe: checks column/table existence before altering
-- Run after migrate_003.sql
-- ═══════════════════════════════════════════════════════════════════════

SET FOREIGN_KEY_CHECKS = 0;

-- ─── Helper: add column to orders if not exists ──────────────────────────────
-- (Repeat pattern for each column — most compatible across MySQL 5.7 / 8 / 9)

-- source_type
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='source_type');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN source_type ENUM('WALKIN','POST_TH','LAZADA','SHOPEE','ALIPAY','TIKTOK','MAKRO','LOTUS','WATSON','KERRY','FLASH','JT','DHL','OTHER_CARRIER','OTHER') NOT NULL DEFAULT 'WALKIN' COMMENT 'แหล่งที่มาของสินค้า'", "SELECT 'source_type exists' AS info");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- source_tracking_no
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='source_tracking_no');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN source_tracking_no VARCHAR(120) DEFAULT NULL COMMENT 'Tracking เดิมของ Platform'", "SELECT 'source_tracking_no exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- item_count
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='item_count');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN item_count INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'จำนวนชิ้น/กล่อง'", "SELECT 'item_count exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- weight_kg
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='weight_kg');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN weight_kg DECIMAL(8,2) DEFAULT NULL COMMENT 'น้ำหนักจริง (kg)'", "SELECT 'weight_kg exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- dim_l_cm
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='dim_l_cm');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN dim_l_cm DECIMAL(6,1) DEFAULT NULL COMMENT 'ความยาว (cm)'", "SELECT 'dim_l_cm exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- dim_w_cm
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='dim_w_cm');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN dim_w_cm DECIMAL(6,1) DEFAULT NULL COMMENT 'ความกว้าง (cm)'", "SELECT 'dim_w_cm exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- dim_h_cm
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='dim_h_cm');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN dim_h_cm DECIMAL(6,1) DEFAULT NULL COMMENT 'ความสูง (cm)'", "SELECT 'dim_h_cm exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- chargeable_kg
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='chargeable_kg');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN chargeable_kg DECIMAL(8,2) DEFAULT NULL COMMENT 'น้ำหนักคิดเงิน'", "SELECT 'chargeable_kg exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- is_fragile
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='is_fragile');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN is_fragile TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'แตกหักง่าย'", "SELECT 'is_fragile exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- is_high_value
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='is_high_value');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN is_high_value TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'มูลค่าสูง'", "SELECT 'is_high_value exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- screening_status
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='screening_status');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN screening_status ENUM('PENDING','PASSED','CUSTOMS_REQUIRED','REJECTED') NOT NULL DEFAULT 'PENDING' COMMENT 'ผลการคัดกรอง'", "SELECT 'screening_status exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- screening_note
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='screening_note');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN screening_note TEXT DEFAULT NULL", "SELECT 'screening_note exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- screened_by
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='screened_by');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN screened_by BIGINT UNSIGNED DEFAULT NULL", "SELECT 'screened_by exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- screened_at
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='screened_at');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN screened_at DATETIME DEFAULT NULL", "SELECT 'screened_at exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- sticker_printed_at
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='sticker_printed_at');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN sticker_printed_at DATETIME DEFAULT NULL COMMENT 'เวลาพิมพ์ Sticker SNG'", "SELECT 'sticker_printed_at exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- intake_photos
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='intake_photos');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN intake_photos JSON DEFAULT NULL COMMENT 'รูปถ่ายตอนรับสินค้า'", "SELECT 'intake_photos exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- pod_photo_url
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='pod_photo_url');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN pod_photo_url VARCHAR(255) DEFAULT NULL COMMENT 'รูปหลักฐานการส่ง'", "SELECT 'pod_photo_url exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- recipient_name
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='recipient_name');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN recipient_name VARCHAR(120) DEFAULT NULL COMMENT 'ชื่อผู้รับจริง ณ วันส่ง'", "SELECT 'recipient_name exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- delivered_at
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='delivered_at');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN delivered_at DATETIME DEFAULT NULL", "SELECT 'delivered_at exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- delivered_by
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='delivered_by');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN delivered_by BIGINT UNSIGNED DEFAULT NULL", "SELECT 'delivered_by exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- fail_reason
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='fail_reason');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN fail_reason ENUM('NOT_AT_HOME','WRONG_ADDRESS','REFUSED','DAMAGED','COD_REJECTED','OTHER') DEFAULT NULL", "SELECT 'fail_reason exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- fail_count
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='fail_count');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN fail_count TINYINT UNSIGNED NOT NULL DEFAULT 0", "SELECT 'fail_count exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- next_attempt_date
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='next_attempt_date');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN next_attempt_date DATE DEFAULT NULL", "SELECT 'next_attempt_date exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── customers: district, preferred_carrier, notes ───────────────────────────
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customers' AND COLUMN_NAME='district');
SET @s = IF(@c=0, "ALTER TABLE customers ADD COLUMN district VARCHAR(120) DEFAULT NULL COMMENT 'ตำบล/บ้าน/เมือง'", "SELECT 'customers.district exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customers' AND COLUMN_NAME='preferred_carrier');
SET @s = IF(@c=0, "ALTER TABLE customers ADD COLUMN preferred_carrier VARCHAR(60) DEFAULT NULL COMMENT 'ขนส่งปลายทางที่ต้องการ'", "SELECT 'preferred_carrier exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customers' AND COLUMN_NAME='notes');
SET @s = IF(@c=0, "ALTER TABLE customers ADD COLUMN notes TEXT DEFAULT NULL", "SELECT 'customers.notes exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Index เบอร์โทร customers
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customers' AND INDEX_NAME='idx_customers_phone');
SET @s = IF(@idx=0, "ALTER TABLE customers ADD INDEX idx_customers_phone (phone)", "SELECT 'idx_customers_phone exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── trips: เพิ่ม Phase 3 columns ────────────────────────────────────────────
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='direction');
SET @s = IF(@c=0, "ALTER TABLE trips ADD COLUMN direction ENUM('TH_TO_LA','LA_TO_TH') NOT NULL DEFAULT 'TH_TO_LA'", "SELECT 'trips.direction exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='vehicle_plate');
SET @s = IF(@c=0, "ALTER TABLE trips ADD COLUMN vehicle_plate VARCHAR(20) DEFAULT NULL COMMENT 'ทะเบียนรถ'", "SELECT 'vehicle_plate exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='vehicle_type');
SET @s = IF(@c=0, "ALTER TABLE trips ADD COLUMN vehicle_type ENUM('TRUCK','VAN','PICKUP','OTHER') NOT NULL DEFAULT 'TRUCK'", "SELECT 'vehicle_type exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='driver_phone');
SET @s = IF(@c=0, "ALTER TABLE trips ADD COLUMN driver_phone VARCHAR(20) DEFAULT NULL", "SELECT 'driver_phone exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='border_checkpoint');
SET @s = IF(@c=0, "ALTER TABLE trips ADD COLUMN border_checkpoint ENUM('NONGKHAI','MUKDAHAN','SAVANNAKHET','CHONGMEK','OTHER') NOT NULL DEFAULT 'NONGKHAI' COMMENT 'ด่านข้ามแดน'", "SELECT 'border_checkpoint exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='departed_th_at');
SET @s = IF(@c=0, "ALTER TABLE trips ADD COLUMN departed_th_at DATETIME DEFAULT NULL COMMENT 'ออกจากไทย'", "SELECT 'departed_th_at exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='arrived_border_at');
SET @s = IF(@c=0, "ALTER TABLE trips ADD COLUMN arrived_border_at DATETIME DEFAULT NULL", "SELECT 'arrived_border_at exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='crossed_border_at');
SET @s = IF(@c=0, "ALTER TABLE trips ADD COLUMN crossed_border_at DATETIME DEFAULT NULL", "SELECT 'crossed_border_at exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='arrived_la_at');
SET @s = IF(@c=0, "ALTER TABLE trips ADD COLUMN arrived_la_at DATETIME DEFAULT NULL COMMENT 'ถึงคลังลาว'", "SELECT 'arrived_la_at exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='total_weight_kg');
SET @s = IF(@c=0, "ALTER TABLE trips ADD COLUMN total_weight_kg DECIMAL(10,2) DEFAULT NULL", "SELECT 'total_weight_kg exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='total_items');
SET @s = IF(@c=0, "ALTER TABLE trips ADD COLUMN total_items INT UNSIGNED DEFAULT 0", "SELECT 'total_items exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='manifest_pdf_url');
SET @s = IF(@c=0, "ALTER TABLE trips ADD COLUMN manifest_pdf_url VARCHAR(255) DEFAULT NULL", "SELECT 'manifest_pdf_url exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='notes');
SET @s = IF(@c=0, "ALTER TABLE trips ADD COLUMN notes TEXT DEFAULT NULL", "SELECT 'trips.notes exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- trips status extend
ALTER TABLE trips MODIFY COLUMN status
  ENUM('PLANNED','LOADING','DEPARTED','AT_BORDER','CROSSED','ARRIVED','UNLOADING','COMPLETED','CANCELLED')
  NOT NULL DEFAULT 'PLANNED';

-- ─── trip_orders: loaded_by, unloaded_by ─────────────────────────────────────
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trip_orders' AND COLUMN_NAME='loaded_by');
SET @s = IF(@c=0, "ALTER TABLE trip_orders ADD COLUMN loaded_by BIGINT UNSIGNED DEFAULT NULL", "SELECT 'loaded_by exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trip_orders' AND COLUMN_NAME='unloaded_by');
SET @s = IF(@c=0, "ALTER TABLE trip_orders ADD COLUMN unloaded_by BIGINT UNSIGNED DEFAULT NULL", "SELECT 'unloaded_by exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── order_flags ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `order_flags` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`     BIGINT UNSIGNED NOT NULL,
  `flag_type`    ENUM('PROHIBITED','CUSTOMS_REQUIRED','OVERSIZE','OVERWEIGHT','FRAGILE','HIGH_VALUE','LIQUID') NOT NULL,
  `description`  TEXT DEFAULT NULL,
  `flagged_by`   BIGINT UNSIGNED DEFAULT NULL,
  `flagged_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `resolved`     TINYINT(1) NOT NULL DEFAULT 0,
  `resolved_by`  BIGINT UNSIGNED DEFAULT NULL,
  `resolved_at`  DATETIME DEFAULT NULL,
  `resolve_note` TEXT DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_flags_order`  (`order_id`),
  KEY `idx_flags_type`   (`flag_type`),
  CONSTRAINT `fk_flags_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── la_carriers ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `la_carriers` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`                 VARCHAR(100) NOT NULL,
  `name_lo`              VARCHAR(100) DEFAULT NULL,
  `phone`                VARCHAR(30) DEFAULT NULL,
  `contact_person`       VARCHAR(120) DEFAULT NULL,
  `tracking_url_pattern` VARCHAR(255) DEFAULT NULL,
  `coverage_provinces`   JSON DEFAULT NULL,
  `is_active`            TINYINT(1) NOT NULL DEFAULT 1,
  `notes`                TEXT DEFAULT NULL,
  `created_at`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── dispatch_assignments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `dispatch_assignments` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`            BIGINT UNSIGNED NOT NULL,
  `dispatch_type`       ENUM('SNG_DELIVERY','BRANCH_PICKUP','PARTNER_CARRIER','RIDER') NOT NULL DEFAULT 'SNG_DELIVERY',
  `driver_id`           BIGINT UNSIGNED DEFAULT NULL,
  `rider_id`            BIGINT UNSIGNED DEFAULT NULL,
  `branch_id`           BIGINT UNSIGNED DEFAULT NULL,
  `carrier_id`          BIGINT UNSIGNED DEFAULT NULL,
  `carrier_tracking_no` VARCHAR(120) DEFAULT NULL,
  `delivery_zone`       VARCHAR(60) DEFAULT NULL,
  `estimated_delivery`  DATE DEFAULT NULL,
  `dispatched_at`       DATETIME DEFAULT NULL,
  `dispatched_by`       BIGINT UNSIGNED DEFAULT NULL,
  `notes`               TEXT DEFAULT NULL,
  `created_at`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_da_order`    (`order_id`),
  CONSTRAINT `fk_da_order2` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Indexes ─────────────────────────────────────────────────────────────────
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='idx_orders_source_type');
SET @s = IF(@idx=0, "ALTER TABLE orders ADD INDEX idx_orders_source_type (source_type)", "SELECT 'idx exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='idx_orders_screening_status');
SET @s = IF(@idx=0, "ALTER TABLE orders ADD INDEX idx_orders_screening_status (screening_status)", "SELECT 'idx exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── Seed: la_carriers ───────────────────────────────────────────────────────
INSERT IGNORE INTO `la_carriers` (`name`, `name_lo`, `phone`, `is_active`) VALUES
  ('Lao Post', 'ໄປສະນີລາວ', '021-212020', 1),
  ('Phoukham Express', 'ພູຄຳ ເອັກສະເພຣດ', '020-55123456', 1),
  ('Anousith Express', 'ອານຸສິດ ເອັກສະເພຣດ', '020-22334455', 1),
  ('BCEL Speed', 'BCEL Speed', '021-213200', 1);

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'Migration 004 complete.' AS result;
