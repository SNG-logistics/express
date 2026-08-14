-- SNG Logistics migration 024: dedupe + lock down CRM automation rules,
-- quick replies, queues, and SLA rules.
--
-- migrate_crm_001.sql seeds crm_automation_rules and crm_quick_replies with
-- INSERT IGNORE, but neither table had a real UNIQUE key on the seed's natural
-- identity column (rule_name / shortcut_key) — only a PRIMARY KEY on the
-- auto-increment id. INSERT IGNORE only skips a row on an actual key
-- collision, so it gave zero real protection here: every time that file's
-- seed statements executed again, a fresh set of rows landed with new ids
-- instead of being skipped.
--
-- The exact same failure mode hits crm_queues and crm_sla_rules from a
-- SECOND source: scripts/run_crm_migration.mjs's insertDefaultData() runs on
-- every single deploy (not gated behind "tables missing") and INSERT IGNOREs
-- its own separate seed rows into those two tables with no explicit id and
-- no unique key backing it either. (Those two tables' seed INSIDE
-- migrate_crm_001.sql, with explicit primary-key ids 1-5, was already safe —
-- INSERT IGNORE genuinely respects a PK collision.)
--
-- Fix: dedupe whatever already piled up, keeping the oldest (lowest id) row
-- per group, then add the missing UNIQUE keys so this can't happen again
-- regardless of how many times any script re-runs. For crm_queues specifically,
-- existing crm_conversations/crm_assignments/crm_sla_rules rows that point at
-- a duplicate (about-to-be-deleted) queue id are re-pointed at the surviving
-- row FIRST, so nothing gets silently orphaned.
--
-- NOTE: crm_queues also has a second, textually-different seed inside
-- migrate_crm_001.sql (explicit ids 1-5, e.g. 'ทีม Logistics') that is NOT
-- touched here — those rows use different Thai wording than
-- insertDefaultData()'s seed (e.g. 'ทีมขนส่ง') for what's conceptually the
-- same queue, so they aren't exact string duplicates. Merging them would mean
-- picking a canonical name and remapping every reference to it — a real
-- product decision, not a mechanical cleanup, so it's left alone on purpose.
--
-- Idempotent: the DELETEs/UPDATEs are no-ops once deduped, and the ALTERs
-- are guarded.

-- ─── crm_automation_rules: keep oldest row per rule_name ──────────────────────
-- Nothing references crm_automation_rules.id as a foreign key, so this is a
-- plain delete — no remap needed.
DELETE t1 FROM crm_automation_rules t1
INNER JOIN crm_automation_rules t2
  ON t1.rule_name = t2.rule_name AND t1.id > t2.id;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_automation_rules' AND INDEX_NAME='uq_crm_auto_rule_name');
SET @s = IF(@c=0, "ALTER TABLE crm_automation_rules ADD UNIQUE KEY uq_crm_auto_rule_name (rule_name)", "SELECT 'uq_crm_auto_rule_name exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── crm_quick_replies: keep oldest row per non-null shortcut_key ─────────────
-- Nothing references crm_quick_replies.id as a foreign key either. Rows with
-- shortcut_key IS NULL (custom replies with no /slash shortcut) are
-- untouched — NULL <> NULL in SQL, so the join never matches them, and a
-- UNIQUE key on a nullable column only enforces uniqueness among non-NULLs.
DELETE t1 FROM crm_quick_replies t1
INNER JOIN crm_quick_replies t2
  ON t1.shortcut_key = t2.shortcut_key AND t1.id > t2.id
WHERE t1.shortcut_key IS NOT NULL;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_quick_replies' AND INDEX_NAME='uq_crm_qr_shortcut');
SET @s = IF(@c=0, "ALTER TABLE crm_quick_replies ADD UNIQUE KEY uq_crm_qr_shortcut (shortcut_key)", "SELECT 'uq_crm_qr_shortcut exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── crm_queues: re-point every reference at the survivor, THEN dedupe ────────
-- crm_conversations.queue_id, crm_assignments.from_queue_id/to_queue_id, and
-- crm_sla_rules.queue_id all store a crm_queues.id with no enforced FK, so a
-- naive delete would silently orphan any row already pointing at a duplicate.
-- Each UPDATE below maps every "duplicate" queue id to the true group-minimum
-- id in one pass (via the derived table), regardless of how many duplicate
-- layers exist, so it's correct even when done before the DELETE removes them.
UPDATE crm_conversations c
JOIN crm_queues dup ON dup.id = c.queue_id
JOIN (SELECT queue_name, MIN(id) AS min_id FROM crm_queues GROUP BY queue_name) keep
  ON keep.queue_name = dup.queue_name
SET c.queue_id = keep.min_id
WHERE c.queue_id <> keep.min_id;

UPDATE crm_assignments a
JOIN crm_queues dup ON dup.id = a.from_queue_id
JOIN (SELECT queue_name, MIN(id) AS min_id FROM crm_queues GROUP BY queue_name) keep
  ON keep.queue_name = dup.queue_name
SET a.from_queue_id = keep.min_id
WHERE a.from_queue_id <> keep.min_id;

UPDATE crm_assignments a
JOIN crm_queues dup ON dup.id = a.to_queue_id
JOIN (SELECT queue_name, MIN(id) AS min_id FROM crm_queues GROUP BY queue_name) keep
  ON keep.queue_name = dup.queue_name
SET a.to_queue_id = keep.min_id
WHERE a.to_queue_id <> keep.min_id;

UPDATE crm_sla_rules s
JOIN crm_queues dup ON dup.id = s.queue_id
JOIN (SELECT queue_name, MIN(id) AS min_id FROM crm_queues GROUP BY queue_name) keep
  ON keep.queue_name = dup.queue_name
SET s.queue_id = keep.min_id
WHERE s.queue_id <> keep.min_id;

DELETE t1 FROM crm_queues t1
INNER JOIN crm_queues t2
  ON t1.queue_name = t2.queue_name AND t1.id > t2.id;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_queues' AND INDEX_NAME='uq_crm_queue_name');
SET @s = IF(@c=0, "ALTER TABLE crm_queues ADD UNIQUE KEY uq_crm_queue_name (queue_name)", "SELECT 'uq_crm_queue_name exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── crm_sla_rules: keep oldest row per rule_name ──────────────────────────────
-- Nothing references crm_sla_rules.id as a foreign key — plain delete.
DELETE t1 FROM crm_sla_rules t1
INNER JOIN crm_sla_rules t2
  ON t1.rule_name = t2.rule_name AND t1.id > t2.id;

SET @c = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crm_sla_rules' AND INDEX_NAME='uq_crm_sla_rule_name');
SET @s = IF(@c=0, "ALTER TABLE crm_sla_rules ADD UNIQUE KEY uq_crm_sla_rule_name (rule_name)", "SELECT 'uq_crm_sla_rule_name exists'");
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
