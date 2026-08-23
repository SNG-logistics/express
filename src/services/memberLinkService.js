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
import { isLaoPhone } from '../utils/waPhone.js';
import { syncOneLegacyCustomer } from './customerSyncService.js';

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

/**
 * Ensure an active member account is linked to a `customers` row: reuse the
 * one existing row when its phone matches exactly one (findSoleCustomerMatch),
 * otherwise create a fresh `customers` row so the member shows up in the
 * staff-facing customer directory (e.g. /orders/new's sender/receiver
 * search) without waiting on a staff member to add them by hand.
 *
 * No-op if the account is missing or already linked. Never throws — a
 * failure here must never block registration/login; callers just get null.
 * Used by otpService.js (right after REGISTER OTP verification) and
 * scripts/backfill_create_missing_customers.mjs (existing accounts).
 */
export async function linkOrCreateCustomerForAccount(accountId, conn = pool) {
  try {
    const [[account]] = await conn.query(
      `SELECT phone, phone_display, first_name, last_name, legacy_customer_id
       FROM customer_accounts WHERE id = ?`,
      [accountId]
    );
    if (!account || account.legacy_customer_id) return null;

    let legacyId = await findSoleCustomerMatch(account.phone, conn);
    if (!legacyId) {
      const name = `${account.first_name} ${account.last_name || ''}`.trim();
      const [insRes] = await conn.query(
        `INSERT INTO customers (type, name, phone, phone_normalized, country)
         VALUES ('person', ?, ?, ?, ?)`,
        [name, account.phone_display || account.phone, account.phone, isLaoPhone(account.phone) ? 'Laos' : 'Thailand']
      );
      legacyId = insRes.insertId;
      syncOneLegacyCustomer(legacyId).catch(err =>
        console.error('[MemberLink] CRM sync for auto-created customer failed:', err.message)
      );
    }

    await conn.query(
      `UPDATE customer_accounts SET legacy_customer_id = ? WHERE id = ? AND legacy_customer_id IS NULL`,
      [legacyId, accountId]
    );
    return legacyId;
  } catch (err) {
    console.error('[MemberLink] linkOrCreateCustomerForAccount failed:', err.message);
    return null;
  }
}
