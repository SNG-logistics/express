/**
 * Versioned, fail-fast database migration runner.
 *
 * Existing installations created before schema_migrations must first run the
 * verifier, then explicitly baseline old files:
 *   npm run check-db
 *   npm run migrate-db -- --baseline-through=migrate_013_crm_customer_sync.sql
 */
import 'dotenv/config';
import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const dbDir = join(scriptDir, '..', 'database');

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
  'migrate_011_rider_mode.sql',
  'migrate_012_trip_settlement.sql',
  'migrate_crm_001.sql',
  'migrate_013_crm_customer_sync.sql',
  'migrate_014_workflow_notifications.sql',
  'migrate_015_role_enum.sql',
  'migrate_016_shipping_rate_pricing.sql',
];

function checksum(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

async function main() {
  const conn = await createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'sng_logistics',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    multipleStatements: true,
  });

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(160) PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        applied_by VARCHAR(80) NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [[core]] = await conn.query(
      `SELECT COUNT(*) AS count FROM information_schema.tables
       WHERE table_schema=DATABASE() AND table_name='orders'`
    );
    const [[history]] = await conn.query('SELECT COUNT(*) AS count FROM schema_migrations');
    const baselineArg = process.argv.find(arg => arg.startsWith('--baseline-through='));

    if (Number(core.count) > 0 && Number(history.count) === 0 && !baselineArg) {
      throw new Error(
        'Existing database has no migration history. Run the DB verifier, then rerun with ' +
        '--baseline-through=migrate_013_crm_customer_sync.sql'
      );
    }

    if (baselineArg) {
      const through = baselineArg.split('=')[1];
      const end = SQL_FILES.indexOf(through);
      if (end < 0) throw new Error(`Unknown baseline migration: ${through}`);
      for (const file of SQL_FILES.slice(0, end + 1)) {
        const sql = readFileSync(join(dbDir, file), 'utf8');
        await conn.query(
          `INSERT IGNORE INTO schema_migrations (filename, checksum, applied_by)
           VALUES (?, ?, 'legacy-baseline')`,
          [file, checksum(sql)]
        );
      }
      console.log(`Baselined through ${through}`);
    }

    for (const file of SQL_FILES) {
      const sql = readFileSync(join(dbDir, file), 'utf8');
      const digest = checksum(sql);
      const [[applied]] = await conn.query(
        'SELECT checksum FROM schema_migrations WHERE filename=?', [file]
      );
      if (applied) {
        if (applied.checksum !== digest) {
          throw new Error(`Applied migration was modified: ${file}`);
        }
        console.log(`SKIP ${file}`);
        continue;
      }

      console.log(`RUN  ${file}`);
      await conn.query(sql);
      await conn.query(
        `INSERT INTO schema_migrations (filename, checksum, applied_by)
         VALUES (?, ?, ?)`,
        [file, digest, process.env.USER || process.env.USERNAME || 'migration-runner']
      );
      console.log(`OK   ${file}`);
    }
    console.log('Database migrations complete.');
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});
