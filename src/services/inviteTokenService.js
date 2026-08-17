/**
 * src/services/inviteTokenService.js
 *
 * Short-lived, opaque, database-backed tokens for member-registration
 * invite links (customersController.inviteMember → memberController.
 * showRegister). The phone number never appears in the URL itself — only
 * a random token that's meaningless without a server-side lookup.
 */
import crypto from 'crypto';
import pool from '../config/db.js';

const INVITE_TOKEN_TTL_HOURS = 24;

/**
 * Create a new invite token for an already-normalized phone. Old,
 * unconsumed tokens for the same phone are left alone (harmless — each
 * token is single-purpose and short-lived; no need to invalidate them).
 * @returns {Promise<string>} the raw token, to embed in the invite URL
 */
export async function createInviteToken({ phone, countryCode, customerId = null, createdBy }) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO customer_invite_tokens
       (token, phone, country_code, customer_id, created_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [token, phone, countryCode, customerId, createdBy, expiresAt]
  );
  return token;
}

/**
 * Look up an unexpired invite token. Does not consume/expire it on read —
 * a customer may load the register page more than once (refresh, switch
 * tabs) before finally submitting, and this token only ever pre-fills a
 * form field, never bypasses OTP verification, so repeat reads are safe.
 * @returns {Promise<{phone: string, countryCode: string}|null>}
 */
export async function resolveInviteToken(token) {
  if (!token || typeof token !== 'string' || !/^[0-9a-f]{48}$/.test(token)) return null;
  const [[row]] = await pool.query(
    `SELECT phone, country_code FROM customer_invite_tokens
     WHERE token = ? AND expires_at > NOW()`,
    [token]
  );
  if (!row) return null;
  pool.query(`UPDATE customer_invite_tokens SET consumed_at = NOW() WHERE token = ? AND consumed_at IS NULL`, [token])
    .catch(() => {}); // best-effort bookkeeping only — never block the register page on this
  return { phone: row.phone, countryCode: row.country_code };
}
