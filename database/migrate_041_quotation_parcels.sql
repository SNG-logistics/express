-- SNG Logistics migration 041: the Thai leg of a purchase-agent order.
--
-- A purchase-agent parcel travels three legs — SNG buys it, the platform's own
-- courier carries it to SNG's Thai warehouse, then SNG carries it to Laos — and
-- the system only ever recorded the first and the last. The middle leg is the
-- longest (3-7 days) and the one the customer worries about most, because it
-- starts the moment SNG has spent their deposit and ends when the goods are
-- finally in SNG's hands. Until now nothing held the courier, the tracking
-- number, or the arrival date, so quotations sat on `purchased` for days with
-- nothing to show.
--
-- A child table rather than columns on partner_quotations: one Lazada order
-- routinely splits into several boxes, shipped on different days by different
-- couriers. Modelling that as a single set of columns would force staff to
-- overwrite one box's tracking with another's.
--
-- The tracking number is deliberately staff-only. The owner's decision is that
-- customers see how far their goods have got and how many boxes have landed,
-- but never the number or the shop it came from; SNG still needs the number to
-- chase a late parcel and to answer a customer asking on WhatsApp.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, and the column add is guarded.

CREATE TABLE IF NOT EXISTS quotation_parcels (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quotation_id         BIGINT UNSIGNED NOT NULL,
  -- Which box of the order this is, for "2 of 3 boxes have arrived".
  parcel_seq           TINYINT UNSIGNED NOT NULL DEFAULT 1,
  supplier_courier     VARCHAR(60)  NULL COMMENT 'LEX TH / Flash / Kerry / J&T',
  supplier_tracking_no VARCHAR(80)  NULL COMMENT 'staff-only; never shown to the customer',
  item_note            VARCHAR(200) NULL COMMENT 'what is in this box, so a short delivery is identifiable',
  status               ENUM('PENDING','SHIPPED','AT_TH_HUB','LOST') NOT NULL DEFAULT 'PENDING',
  shipped_at           TIMESTAMP NULL DEFAULT NULL,
  arrived_th_hub_at    TIMESTAMP NULL DEFAULT NULL,
  created_by           BIGINT UNSIGNED NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Two boxes cannot both be "box 2" of the same order.
  UNIQUE KEY uq_qp_seq (quotation_id, parcel_seq),
  KEY idx_qp_status (status),
  KEY idx_qp_tracking (supplier_tracking_no),
  CONSTRAINT fk_qp_quotation FOREIGN KEY (quotation_id)
    REFERENCES partner_quotations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The platform's order number sits on the quotation, not the parcel: one
-- Lazada order produces every box below it, and staff search by that number.
SET @exist := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'partner_quotations'
    AND column_name = 'supplier_order_no'
);

SET @sql := IF(@exist = 0,
  'ALTER TABLE partner_quotations
     ADD COLUMN supplier_order_no VARCHAR(80) NULL AFTER platform,
     ADD KEY idx_pq_supplier_order (supplier_order_no)',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
