/**
 * One-off backfill: link existing active member accounts to an active legacy
 * customers row when exactly one row shares the normalized phone number.
 *
 * Safe to re-run: only accounts with legacy_customer_id IS NULL are scanned,
 * and the guarded update never overwrites a link created concurrently.
 */
import pool from '../src/config/db.js';
import { findSoleCustomerMatch } from '../src/services/memberLinkService.js';

async function main() {
  const conn = await pool.getConnection();
  let transactionOpen = false;

  try {
    await conn.beginTransaction();
    transactionOpen = true;

    const [accounts] = await conn.query(
      `SELECT id, phone
       FROM customer_accounts
       WHERE status = 'active'
         AND legacy_customer_id IS NULL
       ORDER BY id`
    );

    let linked = 0;
    let skipped = 0;
    let raced = 0;

    for (const account of accounts) {
      const legacyCustomerId = await findSoleCustomerMatch(account.phone, conn);
      if (!legacyCustomerId) {
        skipped++;
        continue;
      }

      const [result] = await conn.query(
        `UPDATE customer_accounts
         SET legacy_customer_id = ?
         WHERE id = ? AND legacy_customer_id IS NULL`,
        [legacyCustomerId, account.id]
      );
      if (result.affectedRows === 1) linked++;
      else raced++;
    }

    await conn.commit();
    transactionOpen = false;

    console.log(`[Member Link Backfill] Scanned ${accounts.length} active unlinked account(s)`);
    console.log(`[Member Link Backfill] Linked ${linked}, skipped ${skipped}, concurrent changes ${raced}`);
  } catch (error) {
    if (transactionOpen) await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[Member Link Backfill] Failed:', error.message);
  process.exitCode = 1;
});
