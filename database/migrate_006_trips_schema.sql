-- ═══════════════════════════════════════════════════════════════════════
-- SNG Logistics — Migration 006: Update trips table to match tripsController v2
-- Safe: uses IF NOT EXISTS guards for columns, MODIFY for ENUM expansion
-- Run after migrate_005_missing_cols.sql
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Add `direction` column to trips if not exists ────────────────────────────
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='direction');
SET @s = IF(@c=0,
  "ALTER TABLE trips ADD COLUMN direction ENUM('TH_TO_LA','LA_TO_TH') NOT NULL DEFAULT 'TH_TO_LA' COMMENT 'ทิศทางรอบรถ' AFTER trip_date",
  "SELECT 'trips.direction already exists' AS info");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── Add `max_weight` column to trips if not exists ───────────────────────────
SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='max_weight');
SET @s = IF(@c=0,
  "ALTER TABLE trips ADD COLUMN max_weight DECIMAL(10,2) NOT NULL DEFAULT 5000 COMMENT 'น้ำหนักรับสูงสุด (kg)' AFTER direction",
  "SELECT 'trips.max_weight already exists' AS info");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── Modify trips.status ENUM to include all v2 statuses ─────────────────────
-- Old: ENUM('PLANNED','ON_ROUTE','CROSSING','ARRIVED','CLOSED')
-- New: ENUM('PLANNED','LOADING','DEPARTED','AT_BORDER','CROSSED','ARRIVED','UNLOADING','COMPLETED','CANCELLED')
ALTER TABLE trips
  MODIFY COLUMN status
    ENUM('PLANNED','LOADING','DEPARTED','AT_BORDER','CROSSED','ARRIVED','UNLOADING','COMPLETED','CANCELLED','ON_ROUTE','CROSSING','CLOSED')
    NOT NULL DEFAULT 'PLANNED'
    COMMENT 'สถานะรอบรถ — ON_ROUTE/CROSSING/CLOSED are legacy v1 values';

-- ─── Verification ─────────────────────────────────────────────────────────────
-- Run manually to confirm:
-- DESCRIBE trips;
