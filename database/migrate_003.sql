-- ═══════════════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 003: Branch Hub Network
-- Branch sub-locations, riders, deliveries, revenue ledger
-- Run after migrate_002.sql
-- ═══════════════════════════════════════════════════════════════════════

SET FOREIGN_KEY_CHECKS = 0;

-- ─── 1. BRANCHES (สาขาย่อย / จุดกระจายสินค้า) ─────────────────────────
CREATE TABLE IF NOT EXISTS `branches` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_code`     VARCHAR(20)  NOT NULL UNIQUE COMMENT 'e.g. LA-VTE-001',
  `name`            VARCHAR(180) NOT NULL COMMENT 'ชื่อสาขา',
  `operator_name`   VARCHAR(180) NOT NULL COMMENT 'ชื่อเจ้าของ/ผู้ดำเนินการ',
  `phone`           VARCHAR(30)  DEFAULT NULL,
  `email`           VARCHAR(120) DEFAULT NULL,
  `address`         TEXT         DEFAULT NULL,
  `province`        VARCHAR(120) DEFAULT NULL COMMENT 'แขวง (ลาว)',
  `district`        VARCHAR(120) DEFAULT NULL COMMENT 'เมือง',
  `country`         CHAR(2)      NOT NULL DEFAULT 'LA',
  -- GPS สำหรับ auto-assign
  `lat`             DECIMAL(10,8) DEFAULT NULL,
  `lng`             DECIMAL(11,8) DEFAULT NULL,
  -- Zone radius (กม.)
  `zone_a_km`       DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  `zone_b_km`       DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  `zone_c_km`       DECIMAL(5,2) NOT NULL DEFAULT 15.00,
  -- ค่าส่ง per zone (LAK)
  `fee_zone_a`      DECIMAL(12,2) NOT NULL DEFAULT 15000.00,
  `fee_zone_b`      DECIMAL(12,2) NOT NULL DEFAULT 25000.00,
  `fee_zone_c`      DECIMAL(12,2) NOT NULL DEFAULT 40000.00,
  -- Revenue split
  `split_plan`      ENUM('A','B','C') NOT NULL DEFAULT 'A',
  `split_hub_pct`   DECIMAL(5,2) NOT NULL DEFAULT 30.00,
  `split_branch_pct` DECIMAL(5,2) NOT NULL DEFAULT 70.00,
  -- สถานะ
  `status`          ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
  `notes`           TEXT DEFAULT NULL,
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_branches_status` (`status`),
  INDEX `idx_branches_province` (`province`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='สาขาย่อย/จุดกระจายสินค้าในลาว';

-- ─── 2. RIDERS (ไรเดอร์ของแต่ละสาขา) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS `riders` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id`    BIGINT UNSIGNED NOT NULL,
  `name`         VARCHAR(120) NOT NULL,
  `phone`        VARCHAR(30)  NOT NULL,
  `vehicle_type` ENUM('motorcycle','bicycle','car','tuk_tuk') NOT NULL DEFAULT 'motorcycle',
  `vehicle_no`   VARCHAR(30)  DEFAULT NULL,
  `status`       ENUM('active','inactive','busy') NOT NULL DEFAULT 'active',
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_riders_branch` (`branch_id`),
  KEY `idx_riders_status` (`status`),
  CONSTRAINT `fk_riders_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='ไรเดอร์ last-mile ของแต่ละสาขา';

-- ─── 3. BRANCH DELIVERIES (การส่ง branch → ลูกค้า) ─────────────────────
CREATE TABLE IF NOT EXISTS `branch_deliveries` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `delivery_no`    VARCHAR(50)  NOT NULL UNIQUE COMMENT 'e.g. BD-260413-0001',
  `order_id`       BIGINT UNSIGNED NOT NULL,
  `branch_id`      BIGINT UNSIGNED NOT NULL,
  `rider_id`       BIGINT UNSIGNED DEFAULT NULL,
  -- Zone + fees
  `zone`           ENUM('A','B','C','X') NOT NULL DEFAULT 'A',
  `delivery_fee`   DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'ค่าส่ง last-mile (LAK)',
  `fee_currency`   CHAR(3) NOT NULL DEFAULT 'LAK',
  -- Revenue split amounts
  `hub_amount`     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `branch_amount`  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `rider_amount`   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  -- Workflow
  `status`         ENUM('PENDING','ASSIGNED','PICKED_UP','DELIVERED','FAILED','RETURNED') NOT NULL DEFAULT 'PENDING',
  `assigned_at`    TIMESTAMP NULL DEFAULT NULL,
  `picked_up_at`   TIMESTAMP NULL DEFAULT NULL,
  `delivered_at`   TIMESTAMP NULL DEFAULT NULL,
  `fail_reason`    TEXT DEFAULT NULL,
  `fail_count`     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  -- POD
  `recipient_name` VARCHAR(120) DEFAULT NULL COMMENT 'ชื่อผู้รับจริง (ณ วันส่ง)',
  `proof_image`    VARCHAR(255) DEFAULT NULL COMMENT 'รูปหลักฐานการส่ง',
  `notes`          TEXT DEFAULT NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bd_order`  (`order_id`),
  KEY `idx_bd_branch` (`branch_id`),
  KEY `idx_bd_rider`  (`rider_id`),
  KEY `idx_bd_status` (`status`),
  CONSTRAINT `fk_bd_order`  FOREIGN KEY (`order_id`)  REFERENCES `orders`   (`id`),
  CONSTRAINT `fk_bd_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`),
  CONSTRAINT `fk_bd_rider`  FOREIGN KEY (`rider_id`)  REFERENCES `riders`   (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='การจัดส่ง last-mile จากสาขาถึงบ้านลูกค้า';

-- ─── 4. BRANCH REVENUE LEDGER (บัญชีรายรับสาขา) ─────────────────────────
CREATE TABLE IF NOT EXISTS `branch_revenue` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id`    BIGINT UNSIGNED NOT NULL,
  `delivery_id`  BIGINT UNSIGNED DEFAULT NULL,
  `period_month` CHAR(7)      NOT NULL COMMENT 'YYYY-MM',
  `type`         ENUM('delivery_fee','bonus','deduction','payout') NOT NULL,
  `amount`       DECIMAL(12,2) NOT NULL,
  `currency`     CHAR(3) NOT NULL DEFAULT 'LAK',
  `note`         TEXT DEFAULT NULL,
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_br_branch`  (`branch_id`),
  KEY `idx_br_period`  (`period_month`),
  KEY `idx_br_type`    (`type`),
  CONSTRAINT `fk_br_branch`   FOREIGN KEY (`branch_id`)   REFERENCES `branches`          (`id`),
  CONSTRAINT `fk_br_delivery` FOREIGN KEY (`delivery_id`) REFERENCES `branch_deliveries` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='บัญชีรายรับ/จ่ายสาขาแยกรายเดือน';

-- ─── 5. ALTER orders — เพิ่ม branch + GPS columns ───────────────────────
ALTER TABLE `orders`
  ADD COLUMN IF NOT EXISTS `dest_branch_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT 'สาขาปลายทางที่ auto-assign',
  ADD COLUMN IF NOT EXISTS `delivery_zone`  ENUM('A','B','C','X') DEFAULT NULL
    COMMENT 'Zone รัศมีสาขา',
  ADD COLUMN IF NOT EXISTS `last_mile_fee`  DECIMAL(12,2) NOT NULL DEFAULT 0.00
    COMMENT 'ค่าส่ง last-mile (LAK)',
  ADD COLUMN IF NOT EXISTS `receiver_lat`   DECIMAL(10,8) DEFAULT NULL
    COMMENT 'GPS latitude บ้านผู้รับ',
  ADD COLUMN IF NOT EXISTS `receiver_lng`   DECIMAL(11,8) DEFAULT NULL
    COMMENT 'GPS longitude บ้านผู้รับ';

-- ─── FK ใน orders (แยกเพราะ IF NOT EXISTS ไม่รองรับใน ADD CONSTRAINT) ───
-- (ถ้า key นี้มีอยู่แล้วจะ error — ให้ comment ออก)
ALTER TABLE `orders`
  ADD CONSTRAINT `fk_orders_dest_branch`
    FOREIGN KEY (`dest_branch_id`) REFERENCES `branches` (`id`);

-- ─── 6. ALTER users — เพิ่ม role ใหม่ + branch_id ───────────────────────
ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM(
    'admin','staff','manager',
    'thai_warehouse','lao_warehouse',
    'dispatcher','customer_service','finance',
    'branch_operator','rider'
  ) NOT NULL DEFAULT 'staff',
  ADD COLUMN IF NOT EXISTS `branch_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT 'สำหรับ branch_operator และ rider';

ALTER TABLE `users`
  ADD CONSTRAINT `fk_users_branch`
    FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`);

-- ─── 7. Indexes ──────────────────────────────────────────────────────────
ALTER TABLE `orders`
  ADD INDEX IF NOT EXISTS `idx_orders_dest_branch` (`dest_branch_id`),
  ADD INDEX IF NOT EXISTS `idx_orders_delivery_zone` (`delivery_zone`);

SET FOREIGN_KEY_CHECKS = 1;
