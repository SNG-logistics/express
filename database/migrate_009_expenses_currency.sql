-- Migration 009: Add currency column to expenses

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='expenses' AND COLUMN_NAME='currency');
SET @s = IF(@c=0, "ALTER TABLE expenses ADD COLUMN currency ENUM('THB','LAK') NOT NULL DEFAULT 'THB' AFTER amount", "SELECT 'expenses.currency exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SELECT 'Migration 009 complete.' AS result;
