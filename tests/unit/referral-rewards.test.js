import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

const [migration, workflow, service, customers, routes, form, member, profileView] = await Promise.all([
  readFile(new URL('../../database/migrate_035_referral_rewards.sql', import.meta.url), 'utf8'),
  readFile(new URL('../../src/services/orderWorkflowService.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/services/referralRewardService.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/customersController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/routes/customers.js', import.meta.url), 'utf8'),
  readFile(new URL('../../views/customers/form.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/memberController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../views/customer/member/profile.ejs', import.meta.url), 'utf8'),
]);

test('idempotency is a database constraint, not just an application check', () => {
  assert.match(migration, /UNIQUE KEY uq_rre_referred_once \(referred_account_id, role\)/);
  assert.match(service, /err\.code === 'ER_DUP_ENTRY' && err\.message\.includes\('uq_rre_referred_once'\)/);
});

test('DELIVERED hook does not depend on ownsTransaction (most call sites pass their own connection)', () => {
  const hookIdx = workflow.indexOf("if (normalizedTo === 'DELIVERED')");
  assert.ok(hookIdx > -1, 'DELIVERED hook must exist');
  // 'if (ownsTransaction) await conn.commit();' appears twice (the early
  // allowSame return, and the real end-of-function commit) — search from
  // the hook onward so this actually finds the latter, not the former.
  const commitIdx = workflow.indexOf('if (ownsTransaction) await conn.commit();', hookIdx);
  assert.ok(commitIdx > hookIdx, 'hook must run before the owning commit that follows it');
  assert.doesNotMatch(
    workflow.slice(hookIdx, hookIdx + 60),
    /ownsTransaction/,
    'the hook itself must not be gated on ownsTransaction'
  );
  assert.match(workflow, /maybeGrantReferralReward\(conn, order\)/);
});

test('reward resolution uses legacy_customer_id, never a fresh phone-matching scheme', () => {
  assert.match(service, /ca\.legacy_customer_id IN/);
  assert.doesNotMatch(service, /phone_normalized/);
});

test('reward grant never throws out of the workflow hook', () => {
  assert.match(service, /export async function maybeGrantReferralReward/);
  const body = service.slice(
    service.indexOf('export async function maybeGrantReferralReward'),
    service.indexOf('async function grantOnePair')
  );
  assert.match(body, /} catch \(err\) \{/);
  assert.match(body, /console\.error\('\[ReferralReward\]/);
});

test('a disabled referrer blocks both reward rows, not just the referrer\'s', () => {
  const grantFn = service.slice(service.indexOf('async function grantOnePair'));
  assert.match(grantFn, /if \(!referrer \|\| referrer\.status === 'disabled'\) return;/);
});

test('staff redemption is ownership-scoped, idempotent, and role-gated at ROLES_MANAGE', () => {
  assert.match(customers, /WHERE id = \? AND beneficiary_account_id = \? AND status = 'granted'/);
  const redeemLine = routes.split('\n').find(l => l.includes('/referral-rewards/:rewardId/redeem'));
  assert.ok(redeemLine, 'redeem route must exist');
  assert.match(redeemLine, /requireRole\(ROLES_MANAGE\)/);
});

test('invite-member stays at the lower CUSTOMER_EDIT tier, unlike link/unlink/redeem', () => {
  const inviteLine = routes.split('\n').find(l => l.includes('/customers/:id/invite-member'));
  assert.match(inviteLine, /requireRole\(ROLES_CUSTOMER_EDIT\)/);
});

test('staff form shows unredeemed referral credit only when the member link is linked', () => {
  assert.match(form, /referral-rewards\/<%= r\.id %>\/redeem/);
  const render = (rewards) => ejs.render(form, {
    mode: 'edit', error: null, csrfToken: 'test-csrf', user: { role: 'admin' },
    customer: { id: 5, active: 1, name: 'Test', type: 'person' },
    memberLink: { state: 'linked', account: { id: 9, first_name: 'A', last_name: 'B', status: 'active' } },
    referralRewards: rewards,
  });
  assert.match(
    render([{ id: 1, role: 'referred', amount_lak: 20000, granted_at: '2026-08-01T00:00:00.000Z', triggering_job_no: 'SNG-000001' }]),
    /20,000 กีบ/
  );
  assert.match(render([]), /ยังไม่มีเครดิตแนะนำเพื่อนที่รอใช้งาน/);
});

test('update()\'s catch-block re-render no longer omits memberLink (pre-existing latent crash, fixed alongside this change)', () => {
  const updateFn = customers.slice(customers.indexOf('export async function update'), customers.indexOf('export async function remove'));
  assert.match(updateFn, /memberLink: \{ state: 'no_phone', account: null \}/);
  assert.match(updateFn, /referralRewards: \[\]/);
});

test('member profile shows the referral credit balance and leaves the points tile untouched', () => {
  assert.match(member, /getUnredeemedRewards\(customer\.id\)/);
  assert.match(profileView, /referralCreditLak/);
  assert.match(profileView, /t\('member\.points'\) %> \(เร็วๆ นี้\)/);   // points tile still "coming soon"
  assert.doesNotMatch(profileView, /t\('member\.coupons'\)/);            // coupons tile replaced, not left dangling
  const html = ejs.render(profileView, {
    t: (k) => k, account: { first_name: 'A', phone_display: '0812345678', referral_code: 'SNG-AB12' },
    referralCreditLak: 40000,
  });
  assert.match(html, /40,000/);
});
