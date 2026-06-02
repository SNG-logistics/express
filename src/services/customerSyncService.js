/**
 * src/services/customerSyncService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Syncs records from the logistics `customers` table into the CRM
 * `crm_customers` table via the legacy_customer_id bridge column.
 *
 * Functions:
 *   syncOneLegacyCustomer(legacyId)  — UPSERT one customer (real-time hook)
 *   bulkSyncAllLegacy()              — import all unsynced customers in batch
 *   getSyncStats()                   — return { total, synced, unsynced }
 */

import pool from '../config/db.js';

/**
 * UPSERT a single customer from `customers` table → `crm_customers`.
 * Called automatically after create/update in customersController.
 *
 * @param {number|string} legacyId  — customers.id
 * @returns {{ created: boolean, crmId: number } | null}
 */
export async function syncOneLegacyCustomer(legacyId) {
  if (!legacyId) return null;

  // Fetch from legacy table
  const [[src]] = await pool.query(
    `SELECT id, name, phone, email, country, province, city, address, active
     FROM customers WHERE id = ?`,
    [legacyId]
  );
  if (!src || !src.active) return null;

  const preferredLanguage = ['la', 'lao', 'laos', 'ลาว']
    .includes((src.country || '').toLowerCase()) ? 'lo' : 'th';

  // Check if already exists in crm_customers
  const [[existing]] = await pool.query(
    `SELECT id FROM crm_customers WHERE legacy_customer_id = ? LIMIT 1`,
    [legacyId]
  );

  if (existing) {
    // UPDATE existing crm record to keep in sync
    await pool.query(
      `UPDATE crm_customers
       SET full_name         = ?,
           phone             = ?,
           email             = ?,
           country           = ?,
           province          = ?,
           district          = ?,
           address           = ?,
           preferred_language = ?,
           synced_from_legacy = 1,
           last_synced_at    = NOW()
       WHERE id = ?`,
      [
        src.name, src.phone, src.email,
        src.country, src.province, src.city, src.address,
        preferredLanguage,
        existing.id,
      ]
    );
    console.log(`[CustomerSync] Updated crm_customers #${existing.id} ← customers #${legacyId}`);
    return { created: false, crmId: existing.id };
  }

  // INSERT new crm_customers record
  const [result] = await pool.query(
    `INSERT INTO crm_customers
       (legacy_customer_id, customer_code, full_name, phone, email,
        country, province, district, address,
        customer_type, preferred_language,
        synced_from_legacy, last_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CUSTOMER', ?, 1, NOW())`,
    [
      legacyId,
      `SYNC-${legacyId}`,
      src.name,
      src.phone   || null,
      src.email   || null,
      src.country || null,
      src.province|| null,
      src.city    || null,
      src.address || null,
      preferredLanguage,
    ]
  );
  console.log(`[CustomerSync] Created crm_customers #${result.insertId} ← customers #${legacyId}`);
  return { created: true, crmId: result.insertId };
}

/**
 * Bulk import all active customers that don't yet have a crm_customers record.
 * Uses INSERT IGNORE to be safe against race conditions.
 *
 * @returns {{ inserted: number, skipped: number, duration_ms: number }}
 */
export async function bulkSyncAllLegacy() {
  const start = Date.now();

  const [result] = await pool.query(`
    INSERT IGNORE INTO crm_customers
      (legacy_customer_id, customer_code, full_name, phone, email,
       country, province, district, address,
       customer_type, preferred_language,
       synced_from_legacy, last_synced_at, created_at)
    SELECT
      c.id,
      CONCAT('SYNC-', c.id),
      c.name,
      c.phone,
      c.email,
      c.country,
      c.province,
      c.city,
      c.address,
      'CUSTOMER',
      CASE
        WHEN LOWER(COALESCE(c.country,'')) IN ('la','lao','laos','ลาว') THEN 'lo'
        ELSE 'th'
      END,
      1,
      NOW(),
      c.created_at
    FROM customers c
    WHERE c.active = 1
      AND c.id NOT IN (
        SELECT legacy_customer_id
        FROM crm_customers
        WHERE legacy_customer_id IS NOT NULL
      )
  `);

  const inserted = result.affectedRows || 0;

  // Update existing linked records (keep names/phones in sync)
  await pool.query(`
    UPDATE crm_customers cc
    JOIN customers c ON c.id = cc.legacy_customer_id
    SET
      cc.full_name          = c.name,
      cc.phone              = c.phone,
      cc.email              = c.email,
      cc.country            = c.country,
      cc.province           = c.province,
      cc.district           = c.city,
      cc.address            = c.address,
      cc.synced_from_legacy = 1,
      cc.last_synced_at     = NOW()
    WHERE cc.synced_from_legacy = 1
      AND c.active = 1
  `);

  const duration = Date.now() - start;
  console.log(`[CustomerSync] bulkSync done: +${inserted} new records in ${duration}ms`);
  return { inserted, duration_ms: duration };
}

/**
 * Get sync statistics.
 * @returns {{ total_legacy: number, synced: number, unsynced: number }}
 */
export async function getSyncStats() {
  const [[row]] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM customers WHERE active = 1)                     AS total_legacy,
      (SELECT COUNT(*) FROM crm_customers WHERE synced_from_legacy = 1)    AS synced,
      (SELECT COUNT(*) FROM customers c WHERE c.active = 1
         AND c.id NOT IN (
           SELECT legacy_customer_id FROM crm_customers
           WHERE legacy_customer_id IS NOT NULL
         ))                                                                 AS unsynced
  `);
  return {
    total_legacy: Number(row.total_legacy),
    synced:       Number(row.synced),
    unsynced:     Number(row.unsynced),
  };
}
