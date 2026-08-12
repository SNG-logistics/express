#!/usr/bin/env node
/**
 * scripts/run_crm_migration.mjs
 * รัน CRM database migrations ทั้งหมด
 * ใช้ connection settings จาก .env
 *
 * Usage:
 *   node scripts/run_crm_migration.mjs
 *   node scripts/run_crm_migration.mjs --check    ← ตรวจว่า tables มีแล้วหรือยัง
 */

import 'dotenv/config';
import { createPool } from 'mysql2/promise';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CHECK_ONLY = process.argv.includes('--check');

const pool = createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  multipleStatements: true,   // needed for multi-statement SQL files
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

const CRM_TABLES = [
  'crm_channels', 'crm_customers', 'crm_customer_identities',
  'crm_conversations', 'crm_messages', 'crm_tags', 'crm_conversation_tags',
  'crm_queues', 'crm_cases', 'crm_internal_notes', 'crm_quick_replies',
  'crm_assignments', 'crm_sla_rules', 'crm_automation_rules',
];

async function checkTables() {
  const [rows] = await pool.query(`
    SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${CRM_TABLES.map(() => '?').join(',')})
  `, [process.env.DB_NAME, ...CRM_TABLES]);

  const existing = rows.map(r => r.TABLE_NAME);
  const missing  = CRM_TABLES.filter(t => !existing.includes(t));

  console.log(`\n📊 CRM Table Status (${process.env.DB_NAME}):`);
  for (const t of CRM_TABLES) {
    console.log(`  ${existing.includes(t) ? '✅' : '❌'} ${t}`);
  }
  return { existing, missing };
}

async function runMigration(sqlFile, label) {
  const filePath = path.join(ROOT, 'database', sqlFile);
  if (!existsSync(filePath)) {
    console.log(`⚠️  ${label}: file not found (${filePath})`);
    return;
  }

  const sql = readFileSync(filePath, 'utf8');
  console.log(`\n🔄 Running ${label}...`);

  try {
    await pool.query(sql);
    console.log(`✅ ${label} applied successfully`);
  } catch (err) {
    if (err.code === 'ER_TABLE_EXISTS_ERROR') {
      console.log(`ℹ️  ${label}: tables already exist (safe to ignore)`);
    } else {
      console.error(`❌ ${label} error:`, err.message);
    }
  }
}

async function insertDefaultData() {
  // Insert default queues if not exist
  await pool.query(`
    INSERT IGNORE INTO crm_queues (queue_name, queue_type, is_active)
    VALUES
      ('ทีมขนส่ง', 'LOGISTICS', 1),
      ('ทีมการเงิน', 'FINANCE', 1),
      ('ทีมขาย', 'SALES', 1),
      ('ทั่วไป', 'GENERAL', 1)
  `).catch(() => {});

  // Insert default SLA rules
  await pool.query(`
    INSERT IGNORE INTO crm_sla_rules (rule_name, queue_id, first_response_minutes, resolution_minutes, is_active)
    VALUES
      ('Default SLA', NULL, 60, 480, 1)
  `).catch(() => {});

  console.log('✅ Default queues and SLA rules inserted');
}

// ── Main ──────────────────────────────────────────────────────────────────────
try {
  console.log('\n🗄️  SNG Logistics — CRM Migration Runner');
  console.log(`   DB: ${process.env.DB_USER}@${process.env.DB_HOST}/${process.env.DB_NAME}\n`);

  if (CHECK_ONLY) {
    const { missing } = await checkTables();
    if (missing.length === 0) {
      console.log('\n✅ All CRM tables exist — migration not needed');
    } else {
      console.log(`\n⚠️  Missing ${missing.length} tables — run without --check to migrate`);
    }
    process.exit(0);
  }

  // Run migrations
  await runMigration('migrate_crm_001.sql', 'CRM Core Tables (14 tables)');
  await runMigration('migrate_017_security_compat.sql', 'Security Tables');
  // migrate_crm_001.sql redeclares users.role with an older list that drops
  // owner/accounting — re-assert the canonical enum right after so those roles
  // survive every `npm run migrate-crm` (which runs on every deploy).
  await runMigration('migrate_021_role_enum_canonical.sql', 'Canonical role enum (owner/accounting)');

  // Check result
  const { missing } = await checkTables();

  // Insert default data
  if (missing.length === 0) {
    await insertDefaultData();
  }

  if (missing.length === 0) {
    console.log('\n✅ CRM Migration complete — all tables ready!');
  } else {
    console.log(`\n⚠️  Still missing: ${missing.join(', ')}`);
    console.log('   ตรวจสอบ error ด้านบนและ re-run migration');
  }

} catch (err) {
  console.error('\n❌ Migration failed:', err.message);
  if (err.code === 'ECONNREFUSED') {
    console.error('   Cannot connect to DB — ตรวจ DB_HOST, DB_PORT, DB_USER, DB_PASS ใน .env');
  }
  process.exit(1);
} finally {
  await pool.end();
}
