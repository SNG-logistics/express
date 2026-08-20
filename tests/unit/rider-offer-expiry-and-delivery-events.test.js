import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { timedOutMessage, expiredMessage, cancelledMessage } from '../../src/services/riderOfferMessages.js';

const DISPATCH = readFileSync(new URL('../../src/services/riderDispatchService.js', import.meta.url), 'utf8');
const BRANCHES = readFileSync(new URL('../../src/controllers/branchesController.js', import.meta.url), 'utf8');
const ORDERS   = readFileSync(new URL('../../src/controllers/ordersController.js', import.meta.url), 'utf8');
const RIDER    = readFileSync(new URL('../../src/controllers/riderController.js', import.meta.url), 'utf8');

// ─── HQ-direct offer expiry no longer goes to nobody ───────────────────────────

test('expireStaleOffers notifies every offered rider, not only the branch', () => {
  const fn = DISPATCH.slice(DISPATCH.indexOf('export async function expireStaleOffers'));
  const body = fn.slice(0, fn.indexOf('\n// ── Outbox'));
  // The branch message stays conditional on having a branch at all — that
  // part already worked and is untouched.
  assert.match(body, /if \(o\.branch_phone\) \{/);
  // The per-rider notice is unconditional: for an HQ-direct order (branch_id
  // NULL) this is the only notice anyone gets.
  const recipsAt = body.indexOf('delivery_offer_recipients');
  assert.ok(recipsAt > -1, 'must look up who the offer went to');
  assert.match(body, /eventType: `RIDER_OFFER_TIMEOUT:\$\{o\.id\}`/);
  assert.match(body, /eventKey: `RIDER_OFFER_TIMEOUT:\$\{o\.id\}:\$\{r\.rider_user_id\}`/);
});

test('the branch lookup no longer gates whether riders hear about it', () => {
  // Before this fix, a rider offered a job on an HQ-direct order (no branch)
  // learned nothing when it timed out — the same silent gap PR #21 closed
  // for the "moved on elsewhere" case, left open for "nobody claimed it".
  const fn = DISPATCH.slice(DISPATCH.indexOf('export async function expireStaleOffers'));
  const body = fn.slice(0, fn.indexOf('\n// ── Outbox'));
  const branchGateAt = body.indexOf('if (o.branch_phone)');
  const recipsQueryAt = body.indexOf('SELECT dor.rider_user_id, dor.phone FROM delivery_offer_recipients');
  assert.ok(branchGateAt > -1 && recipsQueryAt > -1);
  // The recipients query must sit outside (after) the branch-only if-block,
  // not nested inside it, so it always runs regardless of branch_phone.
  const branchBlockEnd = body.indexOf('}', branchGateAt);
  assert.ok(recipsQueryAt > branchBlockEnd, 'rider notice must not be nested inside the branch-only check');
});

test('sendRiderNotification routes RIDER_OFFER_TIMEOUT through the new rider-facing message', () => {
  assert.match(DISPATCH, /RIDER_OFFER_TIMEOUT[\s\S]{0,40}text = timedOutMessage\(payload\)/);
});

test('the rider-facing timeout wording never tells a rider to use the branch portal', () => {
  // That instruction only makes sense for expiredMessage, sent to branch
  // staff. Sending it verbatim to a rider (the original single-message
  // design) would be nonsensical and was never appropriate even before the
  // HQ-direct gap existed.
  const msg = timedOutMessage({ jobNo: 'SNG-260820-1234' });
  assert.ok(msg.includes('SNG-260820-1234'));
  assert.ok(!/พอร์ทัลสาขา/.test(msg));
  assert.notEqual(msg, expiredMessage({ jobNo: 'SNG-260820-1234' }));
  assert.notEqual(msg, cancelledMessage({ jobNo: 'SNG-260820-1234' }));
});

// ─── DELIVERED bookkeeping parity: delivery_events on all three paths ─────────

test('logEvent is exported so the non-rider completion paths can reuse it', () => {
  assert.match(RIDER, /export async function logEvent\(/);
});

test('branch-confirmed delivery now writes a delivery_events row', () => {
  const fn = BRANCHES.slice(BRANCHES.indexOf('export async function markDelivered'));
  const body = fn.slice(0, fn.indexOf('\n\nexport '));
  assert.match(body, /await logEvent\(orderId, lockedDelivery\.order_rider_id \|\| req\.session\.user\.id, 'DELIVERED'/);
});

test('branch markDelivered attributes the event to the actual rider when the order has one', () => {
  // branch_deliveries.rider_id is a FK to riders.id, not users.id — using it
  // directly would write the wrong kind of id into delivery_events.rider_id.
  // orders.rider_id is the users.id the rider actions elsewhere already key
  // on, so the locked-row query must select it under its own alias.
  assert.match(BRANCHES, /o\.rider_id AS order_rider_id/);
});

test('admin-confirmed delivery now writes a delivery_events row too', () => {
  const fn = ORDERS.slice(ORDERS.indexOf('export async function markDelivered'));
  const body = fn.slice(0, fn.indexOf('\n\nexport async function markDeliveryFailed'));
  assert.match(body, /await logEvent\(id, order\.rider_id \|\| req\.session\.user\?\.id, 'DELIVERED'/);
});

test('neither non-rider path touches delivered_by attribution', () => {
  // Confirmed as a deliberate decision, not an oversight: branch/admin staff
  // stay the attributed confirmer even when a rider physically delivered it.
  // This fix only adds the missing audit trail row, it does not change who
  // orders.delivered_by says did the delivery.
  const branchFn = BRANCHES.slice(BRANCHES.indexOf('export async function markDelivered'));
  const branchBody = branchFn.slice(0, branchFn.indexOf('\n\nexport '));
  assert.match(branchBody, /delivered_by: req\.session\.user\.id/);

  const ordersFn = ORDERS.slice(ORDERS.indexOf('export async function markDelivered'));
  const ordersBody = ordersFn.slice(0, ordersFn.indexOf('\n\nexport async function markDeliveryFailed'));
  assert.match(ordersBody, /delivered_by: req\.session\.user\?\.id \|\| null/);
});
