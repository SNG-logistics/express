-- Migration 008: Add notes column to orders table

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='notes');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN notes TEXT DEFAULT NULL COMMENT 'หมายเหตุ/ลิงก์'", "SELECT 'notes exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SELECT 'Migration 008 complete.' AS result;
