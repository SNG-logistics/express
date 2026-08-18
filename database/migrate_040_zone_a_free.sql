-- SNG Logistics migration 040: Zone A is the free launch-promotion tier.
--
-- Zone A is the short hop a branch makes to win a new customer, so it ships
-- free during the launch push: up to 5 km at no delivery fee. The 5 km radius
-- was already the column default; the fee was not, so a new branch was created
-- charging 15,000 LAK for the tier that is supposed to cost nothing.
--
-- Deliberately only changes the DEFAULT for branches created from here on.
-- Existing branches keep whatever they were configured with — several were set
-- up with deliberate per-branch pricing, and silently rewriting live fees would
-- change what branches and riders have already been promised. Branch zones and
-- fees are now editable at /branches/:id/edit, so applying the promotion to an
-- existing branch is a visible, per-branch decision rather than a side effect
-- of running migrations.
--
-- Idempotent: ALTER ... ALTER COLUMN SET DEFAULT is safe to re-run, and does
-- not touch any existing row.

ALTER TABLE branches ALTER COLUMN fee_zone_a SET DEFAULT 0.00;
