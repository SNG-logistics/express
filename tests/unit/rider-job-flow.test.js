import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { canTransitionOrder } from '../../src/constants/transitions.js';

const BRANCHES  = readFileSync(new URL('../../src/controllers/branchesController.js', import.meta.url), 'utf8');
const ORDERS    = readFileSync(new URL('../../src/controllers/ordersController.js', import.meta.url), 'utf8');
const ROUTES    = readFileSync(new URL('../../src/routes/orders.js', import.meta.url), 'utf8');
const AUTH      = readFileSync(new URL('../../src/middleware/auth.js', import.meta.url), 'utf8');
const DETAIL    = readFileSync(new URL('../../views/orders/detail.ejs', import.meta.url), 'utf8');

// ─── Bug 1: the "ส่งใหม่" retry button ─────────────────────────────────────────

test('DELIVERY_FAILED -> AT_DEST_WH is a legal, unforced transition', () => {
  // retryFailedDelivery must not need force:true — AT_DEST_WH-only is
  // startDelivery's own guard and this is a genuinely legal forward edge.
  assert.equal(canTransitionOrder('DELIVERY_FAILED', 'AT_DEST_WH'), true);
});

test('retryFailedDelivery only accepts a DELIVERY_FAILED order', () => {
  const fn = ORDERS.slice(ORDERS.indexOf('export async function retryFailedDelivery'));
  const body = fn.slice(0, fn.indexOf('\nexport async function releaseRiderAssignment'));
  assert.match(body, /order\.status !== 'DELIVERY_FAILED'/);
  assert.match(body, /toStatus: 'AT_DEST_WH'/);
  assert.ok(!/force:\s*true/.test(body), 'a legal forward edge must not need force');
});

test('retry resets branch_deliveries before transitioning, not after', () => {
  const fn = ORDERS.slice(ORDERS.indexOf('export async function retryFailedDelivery'));
  const body = fn.slice(0, fn.indexOf('\nexport async function releaseRiderAssignment'));
  const resetAt = body.indexOf('resetBranchDeliveryForRetry(pool, id)');
  const transitionAt = body.indexOf('transitionOrder({');
  assert.ok(resetAt > -1 && transitionAt > -1);
  assert.ok(resetAt < transitionAt,
    'the branch_deliveries row must already be PENDING before transitionOrder' +
    ' commits and its post-commit auto-broadcast hook reads it');
});

test('retry never passes its own connection to transitionOrder', () => {
  // Passing `connection` would make transitionOrder skip its post-commit
  // auto-broadcast hooks entirely (ownsTransaction=false) — the whole point
  // of this action is to make that broadcast fire again.
  const fn = ORDERS.slice(ORDERS.indexOf('export async function retryFailedDelivery'));
  const body = fn.slice(0, fn.indexOf('\nexport async function releaseRiderAssignment'));
  assert.ok(!/connection:\s*conn/.test(body));
});

test('resetBranchDeliveryForRetry clears everything that blocks a fresh assign/claim', () => {
  const fn = BRANCHES.slice(BRANCHES.indexOf('export async function resetBranchDeliveryForRetry'));
  const body = fn.slice(0, fn.indexOf('\nexport async function takeBranchCustody'));
  assert.match(body, /rider_id=NULL/);
  assert.match(body, /status='PENDING'/);
  assert.match(body, /assigned_at=NULL/);
  assert.match(body, /picked_up_at=NULL/);
  assert.match(body, /proof_image=NULL/);
  // A hub-forwarded (BRANCH_RECEIVED) order never gets received_at stamped by
  // any other path — without this COALESCE, autoBroadcastOnDestinationArrival
  // would silently refuse to re-broadcast for that (more common) case.
  assert.match(body, /received_at=COALESCE\(received_at,\s*NOW\(\)\)/);
});

test('the retry button posts to the new route, not the old broken one', () => {
  const block = DETAIL.slice(DETAIL.indexOf("canReturn) { %>"));
  const formEnd = block.indexOf('</form>');
  const form = block.slice(0, formEnd);
  assert.match(form, /\/orders\/<%= order\.id %>\/delivery-retry/);
  assert.ok(!/action="\/orders\/<%= order\.id %>\/delivery"/.test(form),
    'must not still post to the AT_DEST_WH-only startDelivery route');
});

test('retry route is gated the same as the action it replaces', () => {
  assert.match(ROUTES, /orders\/:id\/delivery-retry[\s\S]{0,80}requireRole\(ROLES_DELIVERY_WRITE\)/);
});

// ─── Bug 2: branch visibility before the parcel has actually arrived ──────────

test('branchHasCustody requires either arrival signal, not bd.status alone', () => {
  const fn = BRANCHES.slice(BRANCHES.indexOf('function branchHasCustody'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /Boolean\(bd\.received_at\)/);
  assert.match(body, /orderStatus === 'BRANCH_RECEIVED'/);
});

for (const fnName of ['assignRider', 'broadcastDelivery']) {
  test(`${fnName} checks canTransitionOrder before branchHasCustody`, () => {
    const fn = BRANCHES.slice(BRANCHES.indexOf(`export async function ${fnName}`));
    const nextExportAt = fn.indexOf('\nexport async function', 1);
    const body = fn.slice(0, nextExportAt > -1 ? nextExportAt : undefined);
    const moveCheckAt   = body.indexOf("canTransitionOrder(bd.order_status, 'RIDER_ASSIGNED')");
    const custodyCheckAt = body.indexOf('branchHasCustody(bd, bd.order_status)');
    assert.ok(moveCheckAt > -1, `${fnName} is missing the order-moved-on check`);
    assert.ok(custodyCheckAt > -1, `${fnName} is missing the custody check`);
    assert.ok(moveCheckAt < custodyCheckAt, 'the two failure reasons must stay distinct and in order');
  });
}

test('assignRider is wrapped in try/catch — a rejection must not hang the request', () => {
  // Express 4 has no async-error middleware here: an unhandled rejection from
  // withTransaction previously left the HTTP request hanging forever.
  const fn = BRANCHES.slice(BRANCHES.indexOf('export async function assignRider'));
  const nextExportAt = fn.indexOf('\nexport async function', 1);
  const body = fn.slice(0, nextExportAt > -1 ? nextExportAt : undefined);
  assert.match(body, /try\s*\{[\s\S]*withTransaction/);
  assert.match(body, /\}\s*catch\s*\(e\)\s*\{/);
});

test('the two branch refusals use distinct Thai wording', () => {
  assert.match(BRANCHES, /ออเดอร์นี้ถูกดำเนินการไปทางอื่นแล้ว มอบหมายไรเดอร์ไม่ได้อีก/);
  assert.match(BRANCHES, /ออเดอร์นี้ถูกดำเนินการไปทางอื่นแล้ว เปิดรับงานไม่ได้อีก/);
  assert.match(BRANCHES, /พัสดุยังไม่ถึงสาขา รอสแกนรับเข้าสาขาก่อน/);
});

test('the branch dashboard queue hides a PENDING row until custody is proven', () => {
  const query = BRANCHES.slice(BRANCHES.indexOf('const [queue] = await pool.query'));
  const body = query.slice(0, query.indexOf('ORDER BY bd.zone'));
  assert.match(body, /bd\.status IN \('ASSIGNED','PICKED_UP'\)/);
  assert.match(body, /bd\.status='PENDING' AND \(bd\.received_at IS NOT NULL OR o\.status='BRANCH_RECEIVED'\)/);
});

// ─── Gap 3: a stuck rider assignment ───────────────────────────────────────────

test('RIDER_ASSIGNED/RIDER_ACCEPTED cannot reach BRANCH_RECEIVED or AT_DEST_WH without force', () => {
  // This is a deliberate backward correction, not a normal forward edge — the
  // release action must say force:true, not rely on it becoming legal.
  assert.equal(canTransitionOrder('RIDER_ASSIGNED', 'BRANCH_RECEIVED'), false);
  assert.equal(canTransitionOrder('RIDER_ASSIGNED', 'AT_DEST_WH'), false);
  assert.equal(canTransitionOrder('RIDER_ACCEPTED', 'BRANCH_RECEIVED'), false);
  assert.equal(canTransitionOrder('RIDER_ACCEPTED', 'AT_DEST_WH'), false);
});

test('releaseRiderAssignment only accepts a stuck rider-assigned order', () => {
  const fn = ORDERS.slice(ORDERS.indexOf('export async function releaseRiderAssignment'));
  assert.match(fn, /!\['RIDER_ASSIGNED', 'RIDER_ACCEPTED'\]\.includes\(order\.status\)/);
});

test('releaseRiderAssignment frees the rider and forces the backward transition', () => {
  const fn = ORDERS.slice(ORDERS.indexOf('export async function releaseRiderAssignment'));
  assert.match(fn, /UPDATE riders SET status='active' WHERE user_id=\?/);
  assert.match(fn, /force:\s*true/);
  assert.match(fn, /updates:\s*\{\s*rider_id:\s*null\s*\}/);
});

test('releaseRiderAssignment sends a branch-scoped order back to BRANCH_RECEIVED, an HQ-direct one to AT_DEST_WH', () => {
  const fn = ORDERS.slice(ORDERS.indexOf('export async function releaseRiderAssignment'));
  assert.match(fn, /const backTo = order\.dest_branch_id \? 'BRANCH_RECEIVED' : 'AT_DEST_WH'/);
});

test('releaseRiderAssignment also resets any branch_deliveries row', () => {
  const fn = ORDERS.slice(ORDERS.indexOf('export async function releaseRiderAssignment'));
  assert.match(fn, /resetBranchDeliveryForRetry\(pool, id\)/);
});

test('release-rider route is gated to central dispatch only, not branch_operator', () => {
  assert.match(ROUTES, /orders\/:id\/release-rider[\s\S]{0,80}requireRole\(ROLES_RIDER_REASSIGN\)/);
  const roles = AUTH.slice(AUTH.indexOf('ROLES_RIDER_REASSIGN ='));
  const line = roles.slice(0, roles.indexOf('\n'));
  assert.ok(!/branch_operator/.test(line), 'this is a new capability, not one handed to branches on day one');
  assert.match(line, /'admin', 'manager', 'dispatcher'/);
});

test('the release-rider button only shows for a stuck rider-assigned order', () => {
  assert.match(DETAIL, /const canReleaseRider = !isLocked && \['RIDER_ASSIGNED','RIDER_ACCEPTED'\]\.includes\(order\.status\) && isDispatch/);
  assert.match(DETAIL, /canReleaseRider\) \{ %>[\s\S]{0,300}\/orders\/<%= order\.id %>\/release-rider/);
});
