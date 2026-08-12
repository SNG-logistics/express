-- MySQL-compatible and idempotent rider-mode migration.
-- Replaces migrate_011_rider_mode.sql, whose signed INT foreign key is
-- incompatible with the BIGINT UNSIGNED primary keys in schema.sql.

SET @clauses = '';

SET @clauses = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='rider_id'),
  @clauses,
  CONCAT(@clauses, 'ADD COLUMN rider_id BIGINT UNSIGNED NULL')
);
SET @clauses = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='assigned_at'),
  @clauses,
  CONCAT(@clauses, IF(@clauses='', '', ', '), 'ADD COLUMN assigned_at DATETIME NULL')
);
SET @clauses = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='accepted_at'),
  @clauses,
  CONCAT(@clauses, IF(@clauses='', '', ', '), 'ADD COLUMN accepted_at DATETIME NULL')
);
SET @clauses = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='picked_up_at'),
  @clauses,
  CONCAT(@clauses, IF(@clauses='', '', ', '), 'ADD COLUMN picked_up_at DATETIME NULL')
);
SET @clauses = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='out_for_delivery_at'),
  @clauses,
  CONCAT(@clauses, IF(@clauses='', '', ', '), 'ADD COLUMN out_for_delivery_at DATETIME NULL')
);
SET @clauses = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='delivery_failed_at'),
  @clauses,
  CONCAT(@clauses, IF(@clauses='', '', ', '), 'ADD COLUMN delivery_failed_at DATETIME NULL')
);
SET @clauses = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='pod_signature_url'),
  @clauses,
  CONCAT(@clauses, IF(@clauses='', '', ', '), 'ADD COLUMN pod_signature_url VARCHAR(500) NULL')
);
SET @clauses = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='delivery_lat'),
  @clauses,
  CONCAT(@clauses, IF(@clauses='', '', ', '), 'ADD COLUMN delivery_lat DECIMAL(10,8) NULL')
);
SET @clauses = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='delivery_lng'),
  @clauses,
  CONCAT(@clauses, IF(@clauses='', '', ', '), 'ADD COLUMN delivery_lng DECIMAL(11,8) NULL')
);
SET @clauses = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='delivery_accuracy'),
  @clauses,
  CONCAT(@clauses, IF(@clauses='', '', ', '), 'ADD COLUMN delivery_accuracy FLOAT NULL')
);
SET @clauses = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='delivery_distance_m'),
  @clauses,
  CONCAT(@clauses, IF(@clauses='', '', ', '), 'ADD COLUMN delivery_distance_m INT NULL')
);
SET @clauses = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='gps_verified'),
  @clauses,
  CONCAT(@clauses, IF(@clauses='', '', ', '), 'ADD COLUMN gps_verified TINYINT(1) DEFAULT 0')
);
SET @clauses = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='cod_collected_amount'),
  @clauses,
  CONCAT(@clauses, IF(@clauses='', '', ', '), 'ADD COLUMN cod_collected_amount DECIMAL(12,2) DEFAULT 0')
);
SET @clauses = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='fail_note'),
  @clauses,
  CONCAT(@clauses, IF(@clauses='', '', ', '), 'ADD COLUMN fail_note TEXT NULL')
);

SET @statement = IF(@clauses='', "SELECT 'rider-mode order columns exist'", CONCAT('ALTER TABLE orders ', @clauses));
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

CREATE TABLE IF NOT EXISTS delivery_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  rider_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM(
    'ASSIGNED','ACCEPTED','PICKED_UP','DEPARTED',
    'ARRIVED_CUSTOMER','DELIVERED','FAILED','NOTE'
  ) NOT NULL,
  note TEXT NULL,
  lat DECIMAL(10,8) NULL,
  lng DECIMAL(11,8) NULL,
  photo_url VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order (order_id),
  INDEX idx_rider (rider_id),
  CONSTRAINT fk_delivery_events_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @index_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='idx_rider_id'
);
SET @statement = IF(
  @index_exists=0,
  'CREATE INDEX idx_rider_id ON orders (rider_id)',
  "SELECT 'idx_rider_id exists'"
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;
