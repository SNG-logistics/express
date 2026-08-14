-- SNG Logistics migration 023: main-warehouse (HQ) riders.
--
-- riders.branch_id was NOT NULL, meaning every rider had to belong to a branch —
-- there was no way to represent a rider who works out of the main warehouse
-- rather than a branch hub. Orders that reach AT_DEST_WH without ever being
-- routed to a branch (dest_branch_id stays NULL — no nearby branch found, or
-- the order has no receiver GPS) currently get zero automated rider dispatch;
-- staff have to arrange last-mile delivery by hand every time.
--
-- Making branch_id nullable lets a rider be created with branch_id=NULL (an
-- "HQ rider"), and riderDispatchService.broadcastOffer is generalized to query
-- branch_id IS NULL for those riders when dest_branch_id is NULL — reusing the
-- exact same broadcast/claim/WhatsApp machinery branch riders already use.
--
-- Idempotent: MODIFY COLUMN is safe to re-run.

ALTER TABLE riders MODIFY COLUMN branch_id BIGINT UNSIGNED NULL;
