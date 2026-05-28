/**
 * scripts/migrate_db.js
 * Run all SQL migration files in order on the production database.
 * Usage: node scripts/migrate_db.js
 *        OR via Plesk "Run Node.js commands": run migrate-db
 */

import 'dotenv/config';
import { createConnection } from 'mysql2/promise';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(__dirname, '..', 'database');

// Run SQL files in this specific order
const SQL_FILES = [
  'schema.sql',
  'migrate_001.sql',
  'migrate_002.sql',
  'migrate_003.sql',
  'migrate_003b.sql',
  'migrate_004.sql',
  'migrate_005_missing_cols.sql',
  'migrate_security_001.sql',
  'migrate_006_trips_schema.sql',
  'migrate_007_production_sync.sql',
  'migrate_008_orders_notes.sql',
  'migrate_009_expenses_currency.sql',
  'migrate_010_space_booking.sql',
];

async function runMigrations() {
  console.log('🔄 SNG Logistics — Database Migration');
  console.log('   DB_HOST:', process.env.DB_HOST || '127.0.0.1');
  console.log('   DB_NAME:', process.env.DB_NAME || 'sng_logistics');
  console.log('');

  const conn = await createConnection({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASS     || '',
    database: process.env.DB_NAME     || 'sng_logistics',
    multipleStatements: true,  // needed for SQL files with multiple statements
  });

  console.log('✅ Connected to database\n');

  for (const file of SQL_FILES) {
    const filePath = join(DB_DIR, file);
    try {
      const sql = readFileSync(filePath, 'utf8');
      console.log(`▶ Running ${file} ...`);
      await conn.query(sql);
      console.log(`  ✅ ${file} — OK`);
    } catch (err) {
      // Ignore "already exists" / "duplicate column" errors gracefully
      if (err.code === 'ER_TABLE_EXISTS_ERROR' || 
          err.code === 'ER_DUP_FIELDNAME' ||
          err.code === 'ER_DUP_KEYNAME' ||
          err.message.includes('already exists') ||
          err.message.includes('Duplicate')) {
        console.warn(`  ⚠️  ${file} — skipped (already applied): ${err.message}`);
      } else {
        console.error(`  ❌ ${file} — ERROR:`, err.message);
        // Don't stop — continue with next file
      }
    }
  }

  await conn.end();
  console.log('\n🎉 Migration complete!');
}

runMigrations().catch(err => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
