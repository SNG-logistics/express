-- database/migrate_037_online_products_photos.sql
-- Add a multi-photo gallery to online products while preserving the legacy
-- single photo for rows created before this migration.
-- Safe to run repeatedly: the column addition is guarded and the backfill
-- only fills an absent gallery.

SET @c := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'online_products'
    AND column_name = 'photos'
);

SET @s := IF(
  @c = 0,
  'ALTER TABLE online_products ADD COLUMN photos JSON NULL
     COMMENT ''Array of /uploads/products/... paths, first = cover photo''
     AFTER photo_path',
  'SELECT 1'
);
PREPARE st FROM @s;
EXECUTE st;
DEALLOCATE PREPARE st;

-- Carry the old single image into the new gallery without overwriting a
-- gallery that may already have been populated by the application.
UPDATE online_products
SET photos = JSON_ARRAY(photo_path)
WHERE photo_path IS NOT NULL
  AND photos IS NULL;
