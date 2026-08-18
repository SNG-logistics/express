-- SNG Logistics migration 039: remember where a customer actually lives.
--
-- orders.receiver_lat/receiver_lng have existed since migrate_003b and are read
-- in three places — the rider's job map, findNearestBranch, and the zone/fee
-- calculation — but nothing in the codebase has ever WRITTEN them. There is no
-- form, endpoint, or import that sets a receiver pin, so every order carries a
-- NULL location. That single gap cascades: findNearestBranch always returns
-- null, so automatic branch routing never fires and staff must send every
-- parcel to a branch by hand; and with no distance to measure, the delivery
-- zone falls through to 'X' with a zero last-mile fee.
--
-- Two sources can fill it, and both are things the business already does:
--   WHATSAPP_PIN     — the customer taps 📎 → Location in the WhatsApp thread
--                      they already have with SNG. waToCrmBridge already parses
--                      locationMessage; it just had nowhere to put the coords.
--   RIDER_DELIVERY   — the rider's GPS at the moment of a successful delivery,
--                      already captured as orders.delivery_lat/lng for proof of
--                      delivery and then discarded. Reusing it means every
--                      repeat parcel to the same person is pinned for free.
--
-- Storing the pin on the customer (not just the order) is what makes it carry
-- forward: the next order for that receiver copies the coordinates at creation.
-- location_source records which of the two supplied it, so a precise rider
-- reading is never silently overwritten by a coarser one.
--
-- Idempotent: each column is only added when it does not already exist.

SET @exist := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'customers'
    AND column_name = 'lat'
);

SET @sql := IF(@exist = 0,
  'ALTER TABLE customers
     ADD COLUMN lat DECIMAL(10,8) NULL DEFAULT NULL,
     ADD COLUMN lng DECIMAL(11,8) NULL DEFAULT NULL,
     ADD COLUMN location_source ENUM(''WHATSAPP_PIN'',''RIDER_DELIVERY'',''STAFF'') NULL DEFAULT NULL,
     ADD COLUMN location_updated_at TIMESTAMP NULL DEFAULT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
