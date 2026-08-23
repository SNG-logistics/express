/**
 * One-off backfill: for every active member account with no legacy_customer_id
 * yet (registered before the register→customers auto-link/create fix),
 * link it to an existing customers row when exactly one shares the phone,
 * otherwise create a fresh customers row — same rule OTP verification now
 * applies at registration time. Run once after deploying that fix so
 * already-registered members show up in the staff-facing customer
 * directory (e.g. /orders/new's sender/receiver search) without re-signing up.
 *
 * Safe to re-run: only accounts with legacy_customer_id IS NULL are scanned.
 */
import pool from '../src/config/db.js';
import { linkOrCreateCustomerForAccount } from '../src/services/memberLinkService.js';

async function main() {
  console.log('[Backfill Missing Customers] Starting...');

  const [accounts] = await pool.query(
    `SELECT id FROM customer_accounts WHERE status = 'active' AND legacy_customer_id IS NULL ORDER BY id`
  );

  let linked = 0;
  let failed = 0;

  for (const account of accounts) {
    const legacyId = await linkOrCreateCustomerForAccount(account.id);
    if (legacyId) linked++;
    else failed++;
  }

  console.log(`[Backfill Missing Customers] Scanned ${accounts.length} active unlinked account(s)`);
  console.log(`[Backfill Missing Customers] Linked/created ${linked}, failed ${failed}`);
}

main()
  .catch((error) => {
    // Logged to both streams: some host panels (e.g. Plesk's "Run Node.js
    // commands" box) only display stdout, so a stderr-only message can look
    // like the command produced no output at all.
    console.log('[Backfill Missing Customers] Failed:', error.message);
    console.error('[Backfill Missing Customers] Failed:', error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
