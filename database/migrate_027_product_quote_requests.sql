-- ═══════════════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 027: Product Quote Requests (Public)
-- ═══════════════════════════════════════════════════════════════════════
-- Public intake for the "เช็คราคาสินค้าออนไลน์จากไทย" service.
-- Captures customer INTENT only (no pricing fields) — pricing stays
-- staff-computed inside partner_quotations. Staff convert a request into
-- a real quotation; the link back is stored on linked_quotation_id.
-- Safe to run multiple times (IF NOT EXISTS guard).
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS product_quote_requests (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  customer_account_id BIGINT UNSIGNED NOT NULL,
  product_url TEXT NULL,
  product_name VARCHAR(500) NOT NULL,
  desired_qty SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  note TEXT NULL,
  status ENUM('new','in_progress','quoted','closed') NOT NULL DEFAULT 'new',
  linked_quotation_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pqr_account (customer_account_id),
  INDEX idx_pqr_status (status),
  CONSTRAINT fk_pqr_account FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id),
  CONSTRAINT fk_pqr_quotation FOREIGN KEY (linked_quotation_id) REFERENCES partner_quotations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='คำขอเช็คราคาสินค้าออนไลน์จากไทย (public intake → partner_quotations)';
