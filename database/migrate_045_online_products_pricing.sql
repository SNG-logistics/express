-- database/migrate_045_online_products_pricing.sql
-- Online product pricing: the selling price, an optional struck-through
-- original price, and the colour of the selling-price text on the member
-- product card at /member/online.
--
-- Safe to run repeatedly, following the migrate_037 pattern: every column
-- addition is guarded by an information_schema check, and the backfill only
-- fixes rows whose colour shipped as NULL/empty before the default existed.
-- Existing product data (photos, badges, links, status, sort order) is
-- never touched.

SET @c := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'online_products'
    AND column_name = 'price'
);

SET @s := IF(
  @c = 0,
  'ALTER TABLE online_products ADD COLUMN price DECIMAL(10,2) NULL
     COMMENT ''Selling price in THB'' AFTER photos',
  'SELECT 1'
);
PREPARE st FROM @s;
EXECUTE st;
DEALLOCATE PREPARE st;

SET @c := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'online_products'
    AND column_name = 'original_price'
);

SET @s := IF(
  @c = 0,
  'ALTER TABLE online_products ADD COLUMN original_price DECIMAL(10,2) NULL
     COMMENT ''Original (struck-through) price in THB'' AFTER price',
  'SELECT 1'
);
PREPARE st FROM @s;
EXECUTE st;
DEALLOCATE PREPARE st;

SET @c := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'online_products'
    AND column_name = 'price_color'
);

SET @s := IF(
  @c = 0,
  'ALTER TABLE online_products ADD COLUMN price_color VARCHAR(7) NOT NULL DEFAULT ''#E53935''
     COMMENT ''Hex colour (#RRGGBB) of the selling price'' AFTER original_price',
  'SELECT 1'
);
PREPARE st FROM @s;
EXECUTE st;
DEALLOCATE PREPARE st;

-- Legacy rows created before the column default existed never got a colour.
UPDATE online_products
SET price_color = '#E53935'
WHERE price_color IS NULL OR price_color = '';
