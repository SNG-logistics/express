-- SNG Logistics migration 046: optional birth date on member accounts.
--
-- Powers the "ดูดวง" (horoscope) feature on the member portal — Western zodiac
-- sign + Thai day-of-week lucky color, both computed purely from this date, no
-- other schema needed. Never required at registration; collected later, opt-in,
-- through the existing profile-edit form (customer_accounts.gender is the same
-- shape today).
--
-- Idempotent: only added when it does not already exist.

SET @exist := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'customer_accounts'
    AND column_name = 'birth_date'
);

SET @sql := IF(@exist = 0,
  'ALTER TABLE customer_accounts ADD COLUMN birth_date DATE NULL DEFAULT NULL AFTER gender',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
