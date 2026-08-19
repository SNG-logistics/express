-- SNG Logistics migration 042: give the Thai leg its own quotation statuses.
--
-- `purchased` used to cover everything from "SNG paid the shop" to "the goods
-- are in our Thai warehouse" — typically three to seven days during which the
-- customer's screen never changed, right after they had parted with a deposit.
-- Two statuses split that silence into reportable progress:
--
--   supplier_shipped  at least one box has left the shop
--   at_th_hub         every box that is still coming has reached SNG's warehouse
--
-- Both are DERIVED from quotation_parcels by deriveSupplierStage(), never set by
-- hand, so the quotation is only ever as far along as its slowest box.
--
-- Idempotent: the column type is only rewritten when the new values are absent.

SET @c := (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = DATABASE()
             AND table_name = 'partner_quotations'
             AND column_name = 'status'
             AND column_type NOT LIKE '%at_th_hub%');

SET @s := IF(@c > 0,
  "ALTER TABLE partner_quotations MODIFY COLUMN status
     ENUM('draft','sent','accepted','rejected','purchasing','purchased',
          'supplier_shipped','at_th_hub','ordered','cancelled')
     NOT NULL DEFAULT 'draft'",
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- partner_quotation_status_logs already stores both sides as VARCHAR(30),
-- which holds 'supplier_shipped' — no change needed there.
