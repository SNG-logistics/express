-- SNG Logistics migration 038: branch takes custody where the parcel is unloaded.
--
-- Until now every inbound parcel had to be unloaded at the main destination
-- warehouse first (AT_DEST_WH), and the branch it belonged to was inferred from
-- the RECEIVER's GPS via findNearestBranch — not from where the box physically
-- ended up. When a truck's route passes a branch before reaching the main
-- warehouse, staff either had to drive past the branch and come back, or unload
-- there anyway and have the system believe the parcel sat somewhere else.
--
-- branch_deliveries.received_at records that a branch physically has the parcel
-- in hand (as opposed to merely being routed to it, which is what the default
-- PENDING status means). The rider broadcast keys off this: a branch holding
-- the goods can open the job to its own riders immediately, without waiting for
-- the separate BRANCH_RECEIVED scan that only makes sense when the parcel is
-- forwarded from the main warehouse.
--
-- Idempotent: the column is only added when it does not already exist.

SET @exist := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'branch_deliveries'
    AND column_name = 'received_at'
);

SET @sql := IF(@exist = 0,
  'ALTER TABLE branch_deliveries ADD COLUMN received_at TIMESTAMP NULL DEFAULT NULL AFTER status',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
