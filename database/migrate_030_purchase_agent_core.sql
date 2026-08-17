-- ═══════════════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 030: Purchase-Agent Core (Phase 3.2)
-- ═══════════════════════════════════════════════════════════════════════
-- Turns partner_quotations / product_quote_requests from the "เช็คราคา"
-- seed into a real purchase-agent service:
--   * platform recorded on both sides (lazada/shopee/alibaba/tiktok_shop/makro/other)
--   * quantity-aware quotations (desired_qty)
--   * deposit tracking (deposit_required_lak = converted product cost only,
--     per the owner's deposit policy; payment_status tracks progress toward
--     the DEPOSIT, not the full total)
--   * a richer quotation status machine incl. purchasing/purchased
--   * a dual-actor status log (staff OR customer initiated)
--   * notification outbox decoupled from a real orders row (quote phase has
--     no order yet)
-- Safe to run multiple times (INFORMATION_SCHEMA + PREPARE/EXECUTE guards).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. partner_quotations: widen status to the purchase-agent machine ────────
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE()
             AND table_name = 'partner_quotations'
             AND column_name = 'status'
             AND column_type NOT LIKE '%purchased%');
SET @s := IF(@c > 0,
  "ALTER TABLE partner_quotations MODIFY COLUMN status
     ENUM('draft','sent','accepted','rejected','purchasing','purchased','ordered','cancelled')
     NOT NULL DEFAULT 'draft'",
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 2. partner_quotations: add purchase-agent columns ─────────────────────────
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE()
             AND table_name = 'partner_quotations'
             AND column_name = 'platform');
SET @s := IF(@c = 0,
  "ALTER TABLE partner_quotations
     ADD COLUMN platform ENUM('lazada','shopee','alibaba','tiktok_shop','makro','other')
       NOT NULL DEFAULT 'other' AFTER product_url,
   ADD COLUMN desired_qty SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER product_name,
   ADD COLUMN deposit_required_lak DECIMAL(14,2) NOT NULL DEFAULT 0
       COMMENT '= converted product cost only (owner deposit policy)' AFTER total_lak,
   ADD COLUMN payment_status ENUM('UNPAID','PARTIAL','PAID') NOT NULL DEFAULT 'UNPAID'
       COMMENT 'progress toward deposit_required_lak, not full total' AFTER deposit_required_lak,
   ADD COLUMN paid_amount_lak DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER payment_status,
   ADD COLUMN payment_ref VARCHAR(100) NULL AFTER paid_amount_lak,
   ADD COLUMN paid_at TIMESTAMP NULL AFTER payment_ref,
   ADD COLUMN status_reason TEXT NULL AFTER note",
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 3. product_quote_requests: platform + decline fields + acknowledgment ─────
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE()
             AND table_name = 'product_quote_requests'
             AND column_name = 'platform');
SET @s := IF(@c = 0,
  "ALTER TABLE product_quote_requests
     ADD COLUMN platform ENUM('lazada','shopee','alibaba','tiktok_shop','makro','other')
       NOT NULL DEFAULT 'other' AFTER product_url,
   ADD COLUMN decline_reason TEXT NULL AFTER note,
   ADD COLUMN acknowledged_at TIMESTAMP NULL AFTER decline_reason,
   ADD COLUMN acknowledged_by BIGINT UNSIGNED NULL AFTER acknowledged_at",
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── 4. New dual-actor status log for quotations ───────────────────────────────
CREATE TABLE IF NOT EXISTS partner_quotation_status_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  quotation_id BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(30) NULL,
  to_status VARCHAR(30) NOT NULL,
  note TEXT NULL,
  action_by BIGINT UNSIGNED NULL COMMENT 'users.id — NULL when customer-initiated',
  action_by_customer_id BIGINT UNSIGNED NULL COMMENT 'customer_accounts.id — NULL when staff-initiated',
  action_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pqsl_quotation (quotation_id),
  KEY idx_pqsl_action_at (action_at),
  CONSTRAINT fk_pqsl_quotation FOREIGN KEY (quotation_id)
    REFERENCES partner_quotations(id) ON DELETE CASCADE,
  CONSTRAINT fk_pqsl_user FOREIGN KEY (action_by)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_pqsl_customer FOREIGN KEY (action_by_customer_id)
    REFERENCES customer_accounts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Quotation status history — dual actor (staff or customer)';

-- ── 5. customer_notification_outbox: decouple from a real orders row ─────────
-- order_id becomes nullable (quote/payment phase has no orders row yet) and
-- the quote_request_id / quotation_id link columns are added.
SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE()
             AND table_name = 'customer_notification_outbox'
             AND column_name = 'order_id'
             AND is_nullable = 'NO');
SET @s := IF(@c > 0,
  'ALTER TABLE customer_notification_outbox MODIFY COLUMN order_id BIGINT UNSIGNED NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @fk := (SELECT COUNT(*) FROM information_schema.table_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'customer_notification_outbox'
              AND constraint_name = 'fk_notification_order');
SET @s := IF(@fk > 0,
  'ALTER TABLE customer_notification_outbox DROP FOREIGN KEY fk_notification_order',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
-- Re-add as ON DELETE SET NULL now that the column is nullable.
SET @s := 'ALTER TABLE customer_notification_outbox
           ADD CONSTRAINT fk_notification_order FOREIGN KEY (order_id)
           REFERENCES orders(id) ON DELETE SET NULL';
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE()
             AND table_name = 'customer_notification_outbox'
             AND column_name = 'quote_request_id');
SET @s := IF(@c = 0,
  'ALTER TABLE customer_notification_outbox
     ADD COLUMN quote_request_id BIGINT UNSIGNED NULL AFTER order_id,
   ADD COLUMN quotation_id BIGINT UNSIGNED NULL AFTER quote_request_id,
   ADD KEY idx_notification_quote_request (quote_request_id),
   ADD KEY idx_notification_quotation (quotation_id)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @fk := (SELECT COUNT(*) FROM information_schema.table_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'customer_notification_outbox'
              AND constraint_name = 'fk_notification_quote_request');
SET @s := IF(@fk = 0,
  'ALTER TABLE customer_notification_outbox
     ADD CONSTRAINT fk_notification_quote_request
       FOREIGN KEY (quote_request_id) REFERENCES product_quote_requests(id) ON DELETE SET NULL,
   ADD CONSTRAINT fk_notification_quotation
       FOREIGN KEY (quotation_id) REFERENCES partner_quotations(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
