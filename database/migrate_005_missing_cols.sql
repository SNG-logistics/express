-- Migration 005: Add missing columns to orders table
-- item_description, created_by

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='item_description');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN item_description TEXT DEFAULT NULL COMMENT 'รายละเอียดสินค้า'", "SELECT 'item_description exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='created_by');
SET @s = IF(@c=0, "ALTER TABLE orders ADD COLUMN created_by BIGINT UNSIGNED DEFAULT NULL COMMENT 'user ที่สร้าง order'", "SELECT 'created_by exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SELECT 'Migration 005 complete.' AS result;
