-- ─────────────────────────────────────────────────────────────────────────────
-- migrate_security_001.sql
-- Security hardening: soft-delete support for users table
--
-- Context: usersController.destroy() now does SET status='inactive'
--          instead of hard-DELETE to preserve audit trail.
--
-- Run: mysql -u <user> -p <db_name> < database/migrate_security_001.sql
-- Safe to run multiple times (IGNORE / IF NOT EXISTS guards used)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add deactivated_at column (timestamp when user was soft-deleted)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deactivated_at DATETIME NULL DEFAULT NULL
    COMMENT 'Set when user is deactivated (soft-delete). NULL = active/never deactivated.';

-- 2. Add branch_id FK (needed for branch_operator login context)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS branch_id BIGINT UNSIGNED NULL DEFAULT NULL
    COMMENT 'FK to branches.id — only relevant for branch_operator role';

-- Add index on branch_id for efficient lookups
CREATE INDEX IF NOT EXISTS idx_users_branch_id ON users (branch_id);

-- 3. Ensure status column has the right values (guard against legacy 'deleted')
UPDATE users SET status = 'inactive', deactivated_at = updated_at
  WHERE status NOT IN ('active', 'inactive');

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification query (run manually to confirm)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT id, username, role, status, deactivated_at, branch_id
-- FROM users ORDER BY created_at DESC LIMIT 20;
