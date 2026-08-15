/**
 * One-off backfill: populate customers.phone_normalized (added by
 * migrate_025_customer_accounts.sql) for rows that existed before the
 * column did. Safe to re-run — only touches rows where it's still NULL.
 */
import pool from '../src/config/db.js';
import { toWaPhone } from '../src/utils/waPhone.js';

async function main() {
  const [rows] = await pool.query(
    `SELECT id, phone FROM customers WHERE phone_normalized IS NULL AND phone IS NOT NULL AND phone <> ''`
  );

  console.log(`[Backfill] ${rows.length} customers row(s) need phone_normalized`);

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const normalized = toWaPhone(row.phone);
    if (!normalized) {
      skipped++;
      continue;
    }
    await pool.query(`UPDATE customers SET phone_normalized = ? WHERE id = ?`, [normalized, row.id]);
    updated++;
  }

  console.log(`[Backfill] Updated ${updated}, skipped ${skipped} (unparseable phone)`);
  await pool.end();
}

main().catch(err => {
  console.error('[Backfill] Failed:', err);
  process.exit(1);
});
