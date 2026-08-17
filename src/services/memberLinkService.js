/**
 * src/services/memberLinkService.js
 *
 * Shared lookups for linking a staff-managed `customers` row to a
 * self-service `customer_accounts` (member portal) row via
 * customer_accounts.legacy_customer_id.
 *
 * Used by:
 *   - src/controllers/customersController.js (staff "invite / link member" UI)
 *   - src/services/otpService.js (best-effort auto-link at registration)
 *   - scripts/backfill_legacy_customer_links.mjs (one-off historical backfill)
 */
import pool from '../config/db.js';

/**
 * Find the customer_accounts row (if any) registered under a given
 * already-normalized (toWaPhone) phone. At most one row can ever match —
 * customer_accounts.phone is UNIQUE.
 */
export async function findAccountByPhone(phoneNormalized, conn = pool) {
  if (!phoneNormalized) return null;
  const [[account]] = await conn.query(
    `SELECT id, status, first_name, last_name, legacy_customer_id
     FROM customer_accounts WHERE phone = ? LIMIT 1`,
    [phoneNormalized]
  );
  return account || null;
}

/**
 * Best-effort exactly-one-match lookup: given an already-normalized phone,
 * return the single ACTIVE customers.id whose phone_normalized matches it —
 * or null when there are zero or 2+ matches (ambiguous; caller must never
 * guess). customers.phone has no UNIQUE constraint, so 2+ is a real case.
 */
export async function findSoleCustomerMatch(phoneNormalized, conn = pool) {
  if (!phoneNormalized) return null;
  const [rows] = await conn.query(
    `SELECT id FROM customers WHERE phone_normalized = ? AND active = 1 LIMIT 2`,
    [phoneNormalized]
  );
  return rows.length === 1 ? rows[0].id : null;
}
