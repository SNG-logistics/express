import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [
  service, otp, partner, customers, routes, form, list, migration, backfill,
  migration033, migration034, inviteTokenService, waPhone, member,
] = await Promise.all([
  readFile(new URL('../../src/services/memberLinkService.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/services/otpService.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/partnerController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/customersController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/routes/customers.js', import.meta.url), 'utf8'),
  readFile(new URL('../../views/customers/form.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../views/customers/index.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../database/migrate_032_member_legacy_linkage.sql', import.meta.url), 'utf8'),
  readFile(new URL('../../scripts/backfill_legacy_customer_links.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../../database/migrate_033_customer_account_link_integrity.sql', import.meta.url), 'utf8'),
  readFile(new URL('../../database/migrate_034_customer_invite_tokens.sql', import.meta.url), 'utf8'),
  readFile(new URL('../../src/services/inviteTokenService.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/utils/waPhone.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/memberController.js', import.meta.url), 'utf8'),
]);

test('member lookup service refuses ambiguous legacy-customer phone matches', () => {
  assert.match(service, /FROM customer_accounts WHERE phone = \? LIMIT 1/);
  assert.match(service, /FROM customers WHERE phone_normalized = \? AND active = 1 LIMIT 2/);
  assert.match(service, /return rows\.length === 1 \? rows\[0\]\.id : null/);
});

test('OTP activation auto-links only an unlinked account through the sole-match lookup', () => {
  assert.match(otp, /findSoleCustomerMatch\(account\.phone\)/);
  assert.match(otp, /WHERE id = \? AND legacy_customer_id IS NULL/);
  assert.match(otp, /legacy_customer_id auto-link failed/);
});

test('quotation conversion derives customer_account_id from the source request server-side', () => {
  assert.match(partner, /SELECT customer_account_id FROM product_quote_requests WHERE id = \?/);
  assert.match(partner, /customer_account_id, customer_name, customer_phone/);
  assert.match(partner, /customerAccountId, customer_name \|\| null/);
});

test('staff member-link actions are role-protected and expose every required UI state', () => {
  assert.match(routes, /ROLES_CUSTOMER_EDIT = \['admin', 'manager', 'dispatcher'\]/);
  assert.match(routes, /\/customers\/:id\/invite-member/);
  assert.match(routes, /\/customers\/:id\/link-member/);
  assert.match(customers, /err\.code === 'WHATSAPP_NOT_READY'/);
  assert.match(customers, /ระบบ WhatsApp ไม่พร้อมใช้งานขณะนี้/);
  assert.match(form, /memberLink\.state === 'linked'/);
  assert.match(form, /memberLink\.state === 'linkable'/);
  assert.match(form, /memberLink\.state === 'pending'/);
  assert.match(form, /memberLink\.state === 'invitable'/);
  assert.match(list, /c\.linked_account_id/);
  assert.match(list, /สมาชิกแล้ว/);
});

test('migration and backfill preserve relational linkage contracts', () => {
  assert.match(migration, /fk_ca_legacy_customer/);
  assert.match(migration, /fk_pq_customer_account/);
  assert.match(migration, /ADD COLUMN customer_account_id BIGINT UNSIGNED/);
  assert.match(backfill, /findSoleCustomerMatch\(account\.phone, conn\)/);
  assert.match(backfill, /WHERE id = \? AND legacy_customer_id IS NULL/);
  assert.match(backfill, /Linked \$\{linked\}, skipped \$\{skipped\}/);
});

test('linking identity is a stricter permission than routine customer-service tasks', () => {
  // invite-member: dispatcher-and-above (just sends a WhatsApp link).
  const inviteLine = routes.split('\n').find(l => l.includes('/customers/:id/invite-member'));
  assert.match(inviteLine, /requireRole\(ROLES_CUSTOMER_EDIT\)/);

  // link-member / unlink-member: admin/manager only (changes identity linkage).
  const linkLine = routes.split('\n').find(l => l.includes("'/customers/:id/link-member'"));
  const unlinkLine = routes.split('\n').find(l => l.includes('/customers/:id/unlink-member'));
  assert.match(linkLine, /requireRole\(ROLES_MANAGE\)/);
  assert.match(unlinkLine, /requireRole\(ROLES_MANAGE\)/);
});

test('unlink requires a reason, is transactional, and never deletes the account or customer', () => {
  assert.match(customers, /export async function unlinkMember/);
  const unlinkFn = customers.slice(customers.indexOf('export async function unlinkMember'));
  assert.match(unlinkFn, /if \(!reason\) \{/);
  assert.match(unlinkFn, /กรุณาระบุเหตุผลที่ยกเลิกการเชื่อมบัญชี/);
  assert.match(unlinkFn, /SET legacy_customer_id = NULL WHERE id = \? AND legacy_customer_id = \?/);
  assert.match(unlinkFn, /INSERT INTO customer_account_link_logs/);
  assert.match(unlinkFn, /action_by/);
  assert.doesNotMatch(unlinkFn, /DELETE FROM customer_accounts/);
  assert.doesNotMatch(unlinkFn, /DELETE FROM customers/);

  // linkMember also writes to the same audit trail now (not just unlink).
  const linkFn = customers.slice(customers.indexOf('export async function linkMember'), customers.indexOf('export async function unlinkMember'));
  assert.match(linkFn, /INSERT INTO customer_account_link_logs/);
  assert.match(linkFn, /'linked'/);

  // The unlink control itself is gated to owner/admin/manager in the view too.
  assert.match(form, /\['owner', 'admin', 'manager'\]\.includes\(user\.role\)/);
  assert.match(form, /\/customers\/<%= customer\.id %>\/unlink-member/);
  assert.match(form, /name="reason" required/);
});

test('soft-deleting a linked customer keeps the relationship and says so on the edit page', () => {
  assert.match(form, /!Number\(customer\.active\)/);
  assert.match(form, /ถูกปิดใช้งานแล้ว แต่ยังเชื่อมกับบัญชีสมาชิกอยู่/);
  // The list page badge is unaffected by this — the query it's rendered
  // from already only selects active=1 customers (see customersController.list).
  assert.match(customers, /WHERE c\.active = 1/);
  assert.match(list, /c\.linked_account_id/);
});

test('migration 033 refuses to assert UNIQUE over duplicate data instead of guessing', () => {
  assert.match(migration033, /uq_ca_legacy_customer/);
  assert.match(migration033, /GROUP BY legacy_customer_id HAVING COUNT\(\*\) > 1/);
  assert.match(migration033, /IF\(@idx = 0 AND @dupes = 0,/);
  assert.match(migration033, /CREATE TABLE IF NOT EXISTS customer_account_link_logs/);
  assert.match(migration033, /action ENUM\('linked', 'unlinked'\)/);
});

test('invite language prefers customer.country, then falls back to the phone prefix', () => {
  const inviteFn = customers.slice(customers.indexOf('export async function inviteMember'));
  assert.match(inviteFn, /const countryValue = String\(customer\.country \|\| ''\)\.toLowerCase\(\);/);
  assert.match(inviteFn, /const isLaos = countryValue\s*\n\s*\? \['la', 'lao', 'laos', 'ลาว'\]\.includes\(countryValue\)\s*\n\s*: isLaoPhone\(phone\);/);
  assert.match(customers, /import \{ toWaPhone, isLaoPhone \} from '\.\.\/utils\/waPhone\.js';/);
  assert.match(waPhone, /export function isLaoPhone\(normalizedPhone\)/);
  assert.match(waPhone, /startsWith\('856'\)/);
});

test('OTP messages are bilingual using the same phone-prefix fallback (no country field available there)', () => {
  assert.match(otp, /import \{ toWaPhone, isLaoPhone \} from '\.\.\/utils\/waPhone\.js';/);
  assert.match(otp, /isLaoPhone\(phone\)/);
  assert.match(otp, /ລະຫັດຢືນຢັນ \(OTP\)/);
  assert.match(otp, /ລະຫັດຣີເຊັດລະຫັດຜ່ານ \(OTP\)/);
});

test('member invite links never carry a raw phone number in the URL', () => {
  const inviteFn = customers.slice(customers.indexOf('export async function inviteMember'));
  assert.match(inviteFn, /createInviteToken\(\{/);
  assert.match(inviteFn, /\/register\?invite=\$\{inviteToken\}/);
  assert.doesNotMatch(inviteFn, /\/register\?phone=/);

  assert.match(migration034, /CREATE TABLE IF NOT EXISTS customer_invite_tokens/);
  assert.match(migration034, /UNIQUE KEY uq_cit_token/);

  assert.match(inviteTokenService, /crypto\.randomBytes\(24\)\.toString\('hex'\)/);
  assert.match(inviteTokenService, /WHERE token = \? AND expires_at > NOW\(\)/);

  assert.match(member, /resolveInviteToken/);
  assert.match(member, /req\.query\.invite/);
});
