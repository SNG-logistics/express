-- database/migrate_028_expenses_usd_currency.sql
-- Add USD alongside THB/LAK to expenses.currency (migrate_009_expenses_currency.sql).
-- MODIFY COLUMN is inherently idempotent — re-running with the same
-- definition is a no-op, no guard needed.

ALTER TABLE expenses MODIFY COLUMN currency ENUM('THB','LAK','USD') NOT NULL DEFAULT 'THB';
