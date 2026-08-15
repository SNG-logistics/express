-- database/migrate_025_customer_accounts.sql
-- Phase 1b: Member Accounts + WhatsApp OTP Verification

CREATE TABLE IF NOT EXISTS customer_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(30) NOT NULL,
  phone_display VARCHAR(30) NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NULL,
  gender ENUM('male', 'female', 'other') NULL,
  referral_code VARCHAR(20) NOT NULL,
  referred_by_account_id BIGINT UNSIGNED NULL,
  legacy_customer_id INT UNSIGNED NULL,
  status ENUM('pending_verification', 'active', 'disabled') NOT NULL DEFAULT 'pending_verification',
  phone_verified_at TIMESTAMP NULL,
  avatar_path VARCHAR(255) NULL,
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_customer_phone (phone),
  UNIQUE KEY uq_customer_refcode (referral_code),
  KEY idx_customer_status (status),
  KEY idx_customer_referred (referred_by_account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customer_otp_codes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL,
  phone VARCHAR(30) NOT NULL,
  purpose ENUM('REGISTER', 'RESET_PASSWORD') NOT NULL DEFAULT 'REGISTER',
  code_hash VARCHAR(255) NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 5,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP NULL,
  requested_ip VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_otp_account (account_id),
  KEY idx_otp_phone (phone),
  KEY idx_otp_created (created_at),
  CONSTRAINT fk_otp_account FOREIGN KEY (account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @exist := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'customers'
    AND column_name = 'phone_normalized'
);

SET @sql := IF(@exist = 0, 'ALTER TABLE customers ADD COLUMN phone_normalized VARCHAR(30) NULL AFTER phone, ADD INDEX idx_cust_phone_norm (phone_normalized)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
