-- --------------------------------------------------------
-- Migration 007: Production Sync
-- Adds missing columns to orders and creates new tables for 
-- Quotation & Expense management.
-- --------------------------------------------------------

-- 1. Add new columns to orders
ALTER TABLE orders ADD COLUMN payment_method ENUM('ORIGIN','DEST') NOT NULL DEFAULT 'ORIGIN';
ALTER TABLE orders ADD COLUMN quotation_id BIGINT UNSIGNED NULL;

-- 2. Create partner_quotations table
CREATE TABLE IF NOT EXISTS partner_quotations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  branch_id INT DEFAULT NULL,
  created_by BIGINT UNSIGNED DEFAULT NULL,
  quote_no VARCHAR(50) NOT NULL UNIQUE,
  product_url TEXT,
  product_name VARCHAR(200),
  product_price_thb DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  shipping_th_thb DECIMAL(10,2) NOT NULL DEFAULT '0.00',
  weight_kg DECIMAL(8,2) NOT NULL DEFAULT '0.00',
  exchange_rate DECIMAL(12,4) NOT NULL,
  fx_spread_pct DECIMAL(5,2) NOT NULL DEFAULT '0.00',
  sng_shipping_lak DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  service_fee_lak DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  subtotal_thb DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  total_lak DECIMAL(14,2) NOT NULL,
  customer_name VARCHAR(200) DEFAULT NULL,
  customer_phone VARCHAR(30) DEFAULT NULL,
  customer_address TEXT,
  status ENUM('draft','sent','accepted','ordered','cancelled') NOT NULL DEFAULT 'draft',
  note TEXT,
  order_id BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_pq_branch (branch_id),
  KEY idx_pq_status (status),
  KEY idx_pq_quote_no (quote_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Create expenses table
CREATE TABLE IF NOT EXISTS expenses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category ENUM('CAPITAL', 'TRIP', 'ADMIN') NOT NULL,
  type VARCHAR(120) NOT NULL,
  description TEXT,
  amount DECIMAL(12,2) NOT NULL DEFAULT '0.00',
  paid_by VARCHAR(120) DEFAULT NULL,
  expense_date DATE NOT NULL,
  trip_id BIGINT UNSIGNED DEFAULT NULL,
  receipt_image VARCHAR(255) DEFAULT NULL,
  created_by BIGINT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
