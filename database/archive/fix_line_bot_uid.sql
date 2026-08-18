-- Migration: Fix LINE OA external_account_id to use real Bot UID
-- Run: node scripts/migrate_db.js  OR  paste in phpMyAdmin

UPDATE crm_channels
SET external_account_id = 'U9abbfce2936a2cb4379b08c2acaf007d'
WHERE channel_type = 'LINE_OA'
  AND (external_account_id = '@363chrqu' OR external_account_id IS NULL OR external_account_id = '');

-- Verify
SELECT id, channel_type, channel_name, external_account_id, is_active
FROM crm_channels
WHERE channel_type = 'LINE_OA';
