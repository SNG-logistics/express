-- SNG Logistics migration 022: monthly billing statements (net-off against COD).
--
-- Adds credit-billing support for SENDER customers: a customer with is_credit=1
-- may be charged shipping fees via payment_method='MONTHLY_BILL' instead of paying
-- per-order. Finance later picks a date range and generates a billing_statement
-- that nets total COD collected (only orders whose cod_settlements row is already
-- COLLECTED) against total shipping fees owed, then settles the statement, which
-- bulk-closes every included order (reusing the existing COD_COLLECTED->COD_REMITTED
-- ->CLOSED / DELIVERED->CLOSED transitions in orderWorkflowService.js).
--
-- Also fixes a pre-existing bug: migrate_007 declared payment_method ENUM('ORIGIN','DEST')
-- but every app code path (ordersController.js, new.ejs, edit.ejs, print.ejs) reads/writes
-- 'DESTINATION', not 'DEST' — so "จ่ายปลายทาง" has been silently mismatched against the
-- DB enum since migrate_007. Correcting the enum list also fixes that.
--
-- Idempotent: column/table guards use IF NOT EXISTS or INFORMATION_SCHEMA checks.

-- ─── orders.payment_method: fix enum values + add MONTHLY_BILL ───────────────
ALTER TABLE orders MODIFY COLUMN payment_method ENUM('ORIGIN','DESTINATION','MONTHLY_BILL') NOT NULL DEFAULT 'ORIGIN';

-- ─── customers.is_credit (sender-side credit/billing eligibility) ────────────
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customers' AND COLUMN_NAME='is_credit');
SET @s = IF(@c=0, "ALTER TABLE customers ADD COLUMN is_credit TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'sender may use payment_method=MONTHLY_BILL (วางบิล)'", "SELECT 'customers.is_credit exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── billing_statements ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_statements (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL COMMENT 'sender being billed',
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_cod DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_shipping DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_amount DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'total_cod - total_shipping; positive = SNG owes customer, negative = customer owes SNG',
  status ENUM('OPEN','SETTLED') NOT NULL DEFAULT 'OPEN',
  created_by BIGINT UNSIGNED NULL,
  settled_by BIGINT UNSIGNED NULL,
  settled_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  INDEX idx_billing_statements_customer (customer_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── billing_items (snapshot of orders included in a statement) ──────────────
CREATE TABLE IF NOT EXISTS billing_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  statement_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  cod_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (statement_id) REFERENCES billing_statements(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  UNIQUE KEY uq_billing_items_order (order_id) COMMENT 'an order may only ever appear on one statement'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
