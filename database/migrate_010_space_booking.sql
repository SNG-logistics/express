-- ═══════════════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 010: ร้านฝากส่ง (Space Booking / Partner Freight)
-- Run after migrate_009.sql
-- ═══════════════════════════════════════════════════════════════════════

SET FOREIGN_KEY_CHECKS = 0;

-- ─── 1. FREIGHT_PARTNERS — ข้อมูลร้านฝากส่ง ────────────────────────────
CREATE TABLE IF NOT EXISTS `freight_partners` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `partner_code`    VARCHAR(20)  NOT NULL UNIQUE COMMENT 'e.g. FP-001',
  `company_name`    VARCHAR(200) NOT NULL COMMENT 'ชื่อร้าน/บริษัท',
  `contact_name`    VARCHAR(120) NOT NULL COMMENT 'ชื่อผู้ติดต่อ',
  `phone`           VARCHAR(30)  DEFAULT NULL,
  `line_id`         VARCHAR(80)  DEFAULT NULL,
  `email`           VARCHAR(120) DEFAULT NULL,
  `address`         TEXT         DEFAULT NULL,
  `tax_id`          VARCHAR(30)  DEFAULT NULL COMMENT 'เลขผู้เสียภาษี',
  `business_type`   VARCHAR(100) DEFAULT NULL COMMENT 'ประเภทสินค้า เช่น เสื้อผ้า, อาหาร',
  `default_unit`    ENUM('BOX','SACK','PALLET','BULK') NOT NULL DEFAULT 'BOX',
  `credit_days`     TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'วันเครดิต (0 = ชำระก่อน)',
  `credit_limit_thb` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'วงเงินเครดิตสูงสุด (บาท)',
  `status`          ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
  `notes`           TEXT DEFAULT NULL,
  `created_by`      INT UNSIGNED DEFAULT NULL,
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_fp_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ร้านฝากส่ง / บริษัทขนส่งพาร์ทเนอร์';

-- ─── 2. SPACE_BOOKINGS — การจองพื้นที่ขนส่ง ─────────────────────────────
CREATE TABLE IF NOT EXISTS `space_bookings` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_no`       VARCHAR(30)  NOT NULL UNIQUE COMMENT 'e.g. SB-260522-001',
  `partner_id`       BIGINT UNSIGNED NOT NULL,
  `trip_id`          BIGINT UNSIGNED DEFAULT NULL COMMENT 'ผูกกับทริป (เลือกหลังจองได้)',
  -- ข้อมูลสินค้า/พื้นที่
  `unit_type`        ENUM('BOX','SACK','PALLET','BULK') NOT NULL DEFAULT 'BOX',
  `unit_label`       VARCHAR(80)  DEFAULT NULL COMMENT 'ชื่อเรียกเฉพาะ เช่น กล่องใหญ่',
  `quantity`         SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `dim_l_cm`         DECIMAL(8,2) DEFAULT NULL COMMENT 'ความยาว (ซม.)',
  `dim_w_cm`         DECIMAL(8,2) DEFAULT NULL COMMENT 'ความกว้าง (ซม.)',
  `dim_h_cm`         DECIMAL(8,2) DEFAULT NULL COMMENT 'ความสูง (ซม.)',
  `total_weight_kg`  DECIMAL(8,2) DEFAULT NULL COMMENT 'น้ำหนักรวม (กก.)',
  `cargo_description` TEXT DEFAULT NULL COMMENT 'รายละเอียดสินค้า',
  -- ราคา (ตกลงเองได้ ไม่มี default)
  `unit_price_thb`   DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'ราคาต่อหน่วย (บาท)',
  `discount_thb`     DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'ส่วนลด',
  `total_amount_thb` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'ยอดรวม (บาท)',
  `vat_pct`          DECIMAL(5,2)  NOT NULL DEFAULT 0.00 COMMENT 'VAT % (ถ้ามี)',
  `vat_amount_thb`   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `grand_total_thb`  DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'ยอดสุทธิ (บาท)',
  -- เส้นทาง
  `direction`        ENUM('TH_TO_LA','LA_TO_TH') NOT NULL DEFAULT 'TH_TO_LA',
  `pickup_address`   TEXT DEFAULT NULL COMMENT 'ที่รับสินค้า',
  `delivery_address` TEXT DEFAULT NULL COMMENT 'ที่ส่งสินค้า',
  `special_notes`    TEXT DEFAULT NULL,
  -- สถานะ
  `status`           ENUM('DRAFT','CONFIRMED','LOADED','IN_TRANSIT','COMPLETED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  -- การชำระเงิน
  `payment_type`     ENUM('PREPAY','CREDIT') NOT NULL DEFAULT 'PREPAY',
  `payment_status`   ENUM('UNPAID','PARTIAL','PAID') NOT NULL DEFAULT 'UNPAID',
  `paid_amount_thb`  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `payment_ref`      VARCHAR(100)  DEFAULT NULL COMMENT 'อ้างอิงการโอน/สลิป',
  `paid_at`          TIMESTAMP NULL DEFAULT NULL,
  `due_date`         DATE DEFAULT NULL COMMENT 'วันครบกำหนดชำระ (กรณีเครดิต)',
  -- เอกสาร
  `quote_no`         VARCHAR(30)  DEFAULT NULL COMMENT 'เลขใบเสนอราคา',
  `invoice_no`       VARCHAR(30)  DEFAULT NULL COMMENT 'เลขใบเรียกเก็บเงิน',
  `quote_issued_at`  TIMESTAMP NULL DEFAULT NULL,
  `invoice_issued_at` TIMESTAMP NULL DEFAULT NULL,
  -- audit
  `created_by`       INT UNSIGNED DEFAULT NULL,
  `confirmed_by`     INT UNSIGNED DEFAULT NULL,
  `cancelled_by`     INT UNSIGNED DEFAULT NULL,
  `cancel_reason`    TEXT DEFAULT NULL,
  `created_at`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_sb_partner`  (`partner_id`),
  INDEX `idx_sb_trip`     (`trip_id`),
  INDEX `idx_sb_status`   (`status`),
  INDEX `idx_sb_payment`  (`payment_status`),
  INDEX `idx_sb_created`  (`created_at`),
  CONSTRAINT `fk_sb_partner` FOREIGN KEY (`partner_id`) REFERENCES `freight_partners` (`id`),
  CONSTRAINT `fk_sb_trip`    FOREIGN KEY (`trip_id`)    REFERENCES `trips` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='การจองพื้นที่ขนส่ง (ร้านฝากส่ง)';

-- ─── 3. SPACE_BOOKING_LOGS — ประวัติการเปลี่ยนแปลงสถานะ ─────────────────
CREATE TABLE IF NOT EXISTS `space_booking_logs` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_id`   BIGINT UNSIGNED NOT NULL,
  `from_status`  VARCHAR(30) DEFAULT NULL,
  `to_status`    VARCHAR(30) NOT NULL,
  `note`         TEXT DEFAULT NULL,
  `action_by`    INT UNSIGNED DEFAULT NULL,
  `action_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_sbl_booking` (`booking_id`),
  CONSTRAINT `fk_sbl_booking` FOREIGN KEY (`booking_id`) REFERENCES `space_bookings` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ประวัติสถานะ Space Booking';

SET FOREIGN_KEY_CHECKS = 1;
