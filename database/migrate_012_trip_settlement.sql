-- ═══════════════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 012: Add settlement columns to trips table
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Add settled_by column to trips if not exists ────────────────────────────
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='settled_by');
SET @s = IF(@c=0,
  "ALTER TABLE trips ADD COLUMN settled_by VARCHAR(120) DEFAULT NULL COMMENT 'ผู้เคลียร์จ่ายคืน/ผู้ลงทุน' AFTER driver_name",
  "SELECT 'trips.settled_by already exists' AS info");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── Add settled_at column to trips if not exists ────────────────────────────
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='settled_at');
SET @s = IF(@c=0,
  "ALTER TABLE trips ADD COLUMN settled_at TIMESTAMP NULL DEFAULT NULL COMMENT 'วันเวลาที่เคลียร์จ่ายคืน' AFTER settled_by",
  "SELECT 'trips.settled_at already exists' AS info");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
