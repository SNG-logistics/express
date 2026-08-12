-- Optional per-kilogram component used by both the order UI and server-side pricing.
SET @has_price_per_kg = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE()
    AND table_name='shipping_rates'
    AND column_name='price_per_kg'
);
SET @sql = IF(
  @has_price_per_kg = 0,
  'ALTER TABLE shipping_rates ADD COLUMN price_per_kg DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER price',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
