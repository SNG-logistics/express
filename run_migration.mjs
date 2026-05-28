/**
 * run_migration.mjs — generic migration runner
 * Usage: node run_migration.mjs [filename]
 * Default: migrate_004.sql
 */
import { readFileSync } from 'fs';
import { createPool } from 'mysql2/promise';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

const pool = createPool({
  host:     process.env.DB_HOST || '127.0.0.1',
  port:     process.env.DB_PORT || 3306,
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'sng_logistics',
  multipleStatements: true,
  waitForConnections: true,
});

const filename = process.argv[2] || 'migrate_004.sql';
const sqlFile  = join(__dirname, 'database', filename);
let sql;
try {
  sql = readFileSync(sqlFile, 'utf-8');
} catch (e) {
  console.error(`❌ Cannot read file: ${sqlFile}`);
  process.exit(1);
}

console.log(`🚀 Running ${filename}...`);

try {
  const conn = await pool.getConnection();
  const [results] = await conn.query(sql);
  const resultArr = Array.isArray(results) ? results : [results];
  let success = 0;
  resultArr.forEach((r, i) => {
    if (r && r[0] && r[0].result) {
      console.log(`✅ [${i+1}] ${r[0].result}`);
    } else if (r && r.affectedRows !== undefined) {
      success++;
    }
  });
  console.log(`\n✅ ${filename} done — ${success} statements OK`);
  conn.release();
  process.exit(0);
} catch (err) {
  console.error('\n❌ Migration failed:', err.message);
  if (err.sql) console.error('SQL:', err.sql.substring(0, 300));
  process.exit(1);
}
