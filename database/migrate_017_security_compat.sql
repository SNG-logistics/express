-- MySQL 5.7/8 compatible replacement for the legacy security migration.
-- Adds soft-delete support and the indexes expected by the application verifier.

SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='deactivated_at'
);
SET @statement = IF(
  @column_exists=0,
  "ALTER TABLE users ADD COLUMN deactivated_at DATETIME NULL DEFAULT NULL COMMENT 'Soft-delete timestamp'",
  "SELECT 'users.deactivated_at exists'"
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='branch_id'
);
SET @statement = IF(
  @column_exists=0,
  'ALTER TABLE users ADD COLUMN branch_id BIGINT UNSIGNED NULL DEFAULT NULL',
  "SELECT 'users.branch_id exists'"
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @index_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND INDEX_NAME='idx_users_branch_id'
);
SET @statement = IF(
  @index_exists=0,
  'CREATE INDEX idx_users_branch_id ON users (branch_id)',
  "SELECT 'idx_users_branch_id exists'"
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @index_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='idx_orders_dest_branch'
);
SET @statement = IF(
  @index_exists=0,
  'CREATE INDEX idx_orders_dest_branch ON orders (dest_branch_id)',
  "SELECT 'idx_orders_dest_branch exists'"
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

SET @index_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='idx_orders_delivery_zone'
);
SET @statement = IF(
  @index_exists=0,
  'CREATE INDEX idx_orders_delivery_zone ON orders (delivery_zone)',
  "SELECT 'idx_orders_delivery_zone exists'"
);
PREPARE migration_statement FROM @statement;
EXECUTE migration_statement;
DEALLOCATE PREPARE migration_statement;

UPDATE users
SET status='inactive', deactivated_at=COALESCE(deactivated_at, updated_at, CURRENT_TIMESTAMP)
WHERE status NOT IN ('active', 'inactive');
