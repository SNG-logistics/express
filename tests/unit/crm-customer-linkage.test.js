import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

const BRIDGE  = readFileSync(new URL('../../src/services/waToCrmBridge.js', import.meta.url), 'utf8');
const CHANNEL = readFileSync(new URL('../../src/services/channelService.js', import.meta.url), 'utf8');
const SYNC    = readFileSync(new URL('../../src/services/customerSyncService.js', import.meta.url), 'utf8');
const CRM_CTRL = readFileSync(new URL('../../src/controllers/crmController.js', import.meta.url), 'utf8');
const CUSTOMERS_VIEW = readFileSync(new URL('../../views/crm/customers.ejs', import.meta.url), 'utf8');

// ─── Bug: Lao numbers normalized differently in the CRM bridge ────────────────
// The old inline regex only had a Thai 0->66 rule, no Lao 020/030->856 rule —
// phone-matching against customers.phone_normalized (via toWaPhone elsewhere)
// would silently never fire for a Lao number.

test('waToCrmBridge normalizes phone with the shared toWaPhone util, not its own regex', () => {
  assert.match(BRIDGE, /const \{ toWaPhone \} = await import\('\.\.\/utils\/waPhone\.js'\)/);
  assert.match(BRIDGE, /const phoneNormalized = toWaPhone\(externalId\) \|\| ''/);
  assert.ok(!/replace\(\/\\D\/g, ''\)/.test(BRIDGE), 'the old ad-hoc regex normalization must be gone');
});

// ─── Auto-link on first CRM contact ────────────────────────────────────────────

test('resolveCustomerIdentity imports findSoleCustomerMatch from memberLinkService', () => {
  assert.match(CHANNEL, /import \{ findSoleCustomerMatch \} from '\.\/memberLinkService\.js'/);
});

test('the legacy lookup only runs when no identity already matched', () => {
  const fn = CHANNEL.slice(CHANNEL.indexOf('export async function resolveCustomerIdentity'));
  const body = fn.slice(0, fn.indexOf('\n// ── Conversation matching'));
  const byPhoneAt = body.indexOf("SELECT crm_customer_id FROM crm_customer_identities");
  const soleMatchAt = body.indexOf('findSoleCustomerMatch(phoneNormalized)');
  assert.ok(byPhoneAt > -1 && soleMatchAt > -1);
  assert.ok(byPhoneAt < soleMatchAt, 'identity-phone lookup must run before the legacy customer lookup');
});

test('an existing crm_customers row for the legacy customer is reused, not duplicated', () => {
  // crm_customers.legacy_customer_id has a UNIQUE constraint — inserting a
  // second row for the same legacy_customer_id would fail outright if an
  // already-synced (no-identity-yet) row exists and this check were missed.
  const fn = CHANNEL.slice(CHANNEL.indexOf('export async function resolveCustomerIdentity'));
  const body = fn.slice(0, fn.indexOf('\n  // 4. Create identity record'));
  assert.match(body, /WHERE legacy_customer_id = \? OR \(phone = \? AND legacy_customer_id IS NULL\)/);
});

test('a genuinely new crm_customers row is created with legacy_customer_id set immediately', () => {
  const fn = CHANNEL.slice(CHANNEL.indexOf('export async function resolveCustomerIdentity'));
  const body = fn.slice(0, fn.indexOf('\n  // 4. Create identity record'));
  assert.match(body, /INSERT INTO crm_customers \(full_name, phone, customer_type, legacy_customer_id\)/);
  assert.match(body, /VALUES \(\?, \?, 'CUSTOMER', \?\)/);
});

// ─── Sync no longer creates duplicates for organically-created identities ─────

test('syncOneLegacyCustomer reconciles an organic row before inserting', () => {
  const fn = SYNC.slice(SYNC.indexOf('export async function syncOneLegacyCustomer'));
  const body = fn.slice(0, fn.indexOf('\n/**\n * Bulk import'));
  const organicCheckAt = body.indexOf("WHERE phone = ? AND legacy_customer_id IS NULL LIMIT 1");
  const insertAt = body.indexOf('INSERT INTO crm_customers');
  assert.ok(organicCheckAt > -1 && insertAt > -1);
  assert.ok(organicCheckAt < insertAt, 'the organic-row check must run before the INSERT');
});

test('bulkSyncAllLegacy reconciles organic rows before its INSERT IGNORE pass', () => {
  const fn = SYNC.slice(SYNC.indexOf('export async function bulkSyncAllLegacy'));
  const body = fn.slice(0, fn.indexOf('\n/**\n * Get sync statistics'));
  const reconcileAt = body.indexOf('UPDATE IGNORE crm_customers cc');
  const insertAt = body.indexOf('INSERT IGNORE INTO crm_customers');
  assert.ok(reconcileAt > -1 && insertAt > -1);
  assert.ok(reconcileAt < insertAt, 'reconciliation must run first so the INSERT IGNORE\'s NOT IN sees the linked rows');
});

test('the reconcile UPDATE only auto-links an unambiguous phone match', () => {
  const fn = SYNC.slice(SYNC.indexOf('export async function bulkSyncAllLegacy'));
  const body = fn.slice(0, fn.indexOf('\n/**\n * Get sync statistics'));
  assert.match(body, /HAVING COUNT\(\*\) = 1/);
});

test('the reconcile UPDATE never claims a legacy_customer_id already linked elsewhere', () => {
  const fn = SYNC.slice(SYNC.indexOf('export async function bulkSyncAllLegacy'));
  const body = fn.slice(0, fn.indexOf('\n/**\n * Get sync statistics'));
  assert.match(body, /LEFT JOIN crm_customers already ON already\.legacy_customer_id = sole\.sole_id/);
  assert.match(body, /AND already\.id IS NULL/);
});

test('bulkSyncAllLegacy reports how many organic rows it linked', () => {
  const fn = SYNC.slice(SYNC.indexOf('export async function bulkSyncAllLegacy'));
  const body = fn.slice(0, fn.indexOf('\n/**\n * Get sync statistics'));
  assert.match(body, /return \{ inserted, linked, duration_ms: duration \}/);
});

// ─── Linkage report figures ─────────────────────────────────────────────────

test('getSyncStats reports organic_unlinked and ambiguous_phones', () => {
  const fn = SYNC.slice(SYNC.indexOf('export async function getSyncStats'));
  assert.match(fn, /AS organic_unlinked/);
  assert.match(fn, /AS ambiguous_phones/);
  assert.match(fn, /HAVING COUNT\(\*\) > 1/);
});

test('the sync banner surfaces both new figures, only when nonzero', () => {
  assert.match(CUSTOMERS_VIEW, /if \(syncStats\.organic_unlinked > 0\)/);
  assert.match(CUSTOMERS_VIEW, /if \(syncStats\.ambiguous_phones > 0\)/);
});

test('the sync-run response message mentions the linked count', () => {
  assert.match(CRM_CTRL, /เชื่อมโยงจาก CRM เดิม \$\{result\.linked\}/);
});
