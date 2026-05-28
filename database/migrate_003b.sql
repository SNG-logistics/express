-- ═══════════════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 003b: Branch Hub Network (Safe version)
-- branches, riders, branch_deliveries, branch_revenue
-- Compatible with MySQL 5.7 / 8 / 9 (no ADD COLUMN IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════════════════

SET FOREIGN_KEY_CHECKS = 0;

-- ─── 1. BRANCHES ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `branches` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_code`     VARCHAR(20)  NOT NULL UNIQUE COMMENT 'e.g. LA-VTE-001',
  `name`            VARCHAR(180) NOT NULL,
  `operator_name`   VARCHAR(180) NOT NULL,
  `phone`           VARCHAR(30)  DEFAULT NULL,
  `email`           VARCHAR(120) DEFAULT NULL,
  `address`         TEXT         DEFAULT NULL,
  `province`        VARCHAR(120) DEFAULT NULL,
  `district`        VARCHAR(120) DEFAULT NULL,
  `country`         CHAR(2)      NOT NULL DEFAULT 'LA',
  `lat`             DECIMAL(10,8) DEFAULT NULL,
  `lng`             DECIMAL(11,8) DEFAULT NULL,
  `zone_a_km`       DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  `zone_b_km`       DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  `zone_c_km`       DECIMAL(5,2) NOT NULL DEFAULT 15.00,
  `fee_zone_a`      DECIMAL(12,2) NOT NULL DEFAULT 15000.00,
  `fee_zone_b`      DECIMAL(12,2) NOT NULL DEFAULT 25000.00,
  `fee_zone_c`      DECIMAL(12,2) NOT NULL DEFAULT 40000.00,
  `split_plan`      ENUM('A','B','C') NOT NULL DEFAULT 'A',
  `split_hub_pct`   DECIMAL(5,2) NOT NULL DEFAULT 30.00,
  `split_branch_pct` DECIMAL(5,2) NOT NULL DEFAULT 70.00,
  `status`          ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
  `notes`           TEXT DEFAULT NULL,
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_branches_status`   (`status`),
  INDEX `idx_branches_province` (`province`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 2. RIDERS ───────────────────────────────────────────────────────────────
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
  KEY `idx_riders_branch`  (`branch_id`),
  KEY `idx_riders_status`  (`status`),
  CONSTRAINT `fk_riders_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 3. BRANCH DELIVERIES ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `branch_deliveries` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `delivery_no`    VARCHAR(50)  NOT NULL UNIQUE,
  `order_id`       BIGINT UNSIGNED NOT NULL,
  `branch_id`      BIGINT UNSIGNED NOT NULL,
  `rider_id`       BIGINT UNSIGNED DEFAULT NULL,
  `zone`           ENUM('A','B','C','X') NOT NULL DEFAULT 'A',
  `delivery_fee`   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `fee_currency`   CHAR(3) NOT NULL DEFAULT 'LAK',
  `hub_amount`     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `branch_amount`  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `rider_amount`   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `status`         ENUM('PENDING','ASSIGNED','PICKED_UP','DELIVERED','FAILED','RETURNED') NOT NULL DEFAULT 'PENDING',
  `assigned_at`    TIMESTAMP NULL DEFAULT NULL,
  `picked_up_at`   TIMESTAMP NULL DEFAULT NULL,
  `delivered_at`   TIMESTAMP NULL DEFAULT NULL,
  `fail_reason`    TEXT DEFAULT NULL,
  `fail_count`     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `recipient_name` VARCHAR(120) DEFAULT NULL,
  `proof_image`    VARCHAR(255) DEFAULT NULL,
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 4. BRANCH REVENUE LEDGER ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `branch_revenue` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `branch_id`    BIGINT UNSIGNED NOT NULL,
  `delivery_id`  BIGINT UNSIGNED DEFAULT NULL,
  `period_month` CHAR(7)      NOT NULL,
  `type`         ENUM('delivery_fee','bonus','deduction','payout') NOT NULL,
  `amount`       DECIMAL(12,2) NOT NULL,
  `currency`     CHAR(3) NOT NULL DEFAULT 'LAK',
  `note`         TEXT DEFAULT NULL,
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_br_branch`   (`branch_id`),
  KEY `idx_br_period`   (`period_month`),
  CONSTRAINT `fk_br_branch`   FOREIGN KEY (`branch_id`)   REFERENCES `branches`          (`id`),
  CONSTRAINT `fk_br_delivery` FOREIGN KEY (`delivery_id`) REFERENCES `branch_deliveries` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 5. orders — add dest_branch_id + GPS columns ────────────────────────────
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='dest_branch_id');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN dest_branch_id BIGINT UNSIGNED DEFAULT NULL COMMENT 'สาขาปลายทาง'", "SELECT 'dest_branch_id exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='delivery_zone');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN delivery_zone ENUM('A','B','C','X') DEFAULT NULL", "SELECT 'delivery_zone exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='last_mile_fee');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN last_mile_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00", "SELECT 'last_mile_fee exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='receiver_lat');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN receiver_lat DECIMAL(10,8) DEFAULT NULL", "SELECT 'receiver_lat exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='receiver_lng');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN receiver_lng DECIMAL(11,8) DEFAULT NULL", "SELECT 'receiver_lng exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- FK orders → branches (safe)
SET @fk = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND CONSTRAINT_NAME='fk_orders_dest_branch');
SET @s = IF(@fk=0, "ALTER TABLE orders ADD CONSTRAINT fk_orders_dest_branch FOREIGN KEY (dest_branch_id) REFERENCES branches (id)", "SELECT 'fk_orders_dest_branch exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── 6. users — add branch_id ────────────────────────────────────────────────
ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM(
    'admin','staff','manager',
    'thai_warehouse','lao_warehouse',
    'dispatcher','customer_service','finance',
    'branch_operator','rider'
  ) NOT NULL DEFAULT 'staff';

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='branch_id');
SET @s = IF(@c=0, "ALTER TABLE users ADD COLUMN branch_id BIGINT UNSIGNED DEFAULT NULL", "SELECT 'users.branch_id exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- FK users → branches (safe)
SET @fk = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND CONSTRAINT_NAME='fk_users_branch');
SET @s = IF(@fk=0, "ALTER TABLE users ADD CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches (id)", "SELECT 'fk_users_branch exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'Migration 003b complete. Branch network tables ready.' AS result;
