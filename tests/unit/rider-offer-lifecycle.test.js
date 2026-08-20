import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { canTransitionOrder } from '../../src/constants/transitions.js';
import { cancelledMessage, takenMessage } from '../../src/services/riderOfferMessages.js';

const WORKFLOW   = readFileSync(new URL('../../src/services/orderWorkflowService.js', import.meta.url), 'utf8');
const DISPATCH   = readFileSync(new URL('../../src/services/riderDispatchService.js', import.meta.url), 'utf8');
const CONTROLLER = readFileSync(new URL('../../src/controllers/riderController.js', import.meta.url), 'utf8');
const MIGRATION  = readFileSync(new URL('../../database/migrate_020_rider_job_offers.sql', import.meta.url), 'utf8');

// ─── the rule everything hangs off ────────────────────────────────────────────

test('only two statuses can still take a rider', () => {
  // This is the gate used to decide whether an open offer still means anything.
  // Reusing canTransitionOrder rather than a hardcoded list means a future
  // claimable state is picked up everywhere at once.
  assert.equal(canTransitionOrder('AT_DEST_WH', 'RIDER_ASSIGNED'), true);
  assert.equal(canTransitionOrder('BRANCH_RECEIVED', 'RIDER_ASSIGNED'), true);

  for (const gone of ['OUT_FOR_DELIVERY', 'DELIVERED', 'RIDER_ASSIGNED', 'BRANCH_TRANSFER', 'CLOSED']) {
    assert.equal(canTransitionOrder(gone, 'RIDER_ASSIGNED'), false, `${gone} must not look claimable`);
  }
});

test('the exact transition from the bug report is still refused', () => {
  // "Cannot transition order SNG-260820-4400 from OUT_FOR_DELIVERY to
  // RIDER_ASSIGNED" was correct. The fix is about never reaching it, not about
  // making it legal — allowing it would let a claim reopen a dispatched parcel.
  assert.equal(canTransitionOrder('OUT_FOR_DELIVERY', 'RIDER_ASSIGNED'), false);
});

// ─── the offer is closed when the parcel leaves by another route ──────────────

test('leaving the claimable window cancels the open offer', () => {
  assert.match(WORKFLOW, /if \(!canTransitionOrder\(normalizedTo, 'RIDER_ASSIGNED'\)\)/);
  assert.match(WORKFLOW, /UPDATE delivery_offers SET status='CANCELLED' WHERE id=\? AND status='OPEN'/);
});

test('cancellation runs pre-commit, on the caller\'s connection', () => {
  // Most call sites pass their own connection and never reach the post-commit
  // hooks at the end of transitionOrder. A cancellation hung off those would
  // silently skip the branch and scanner paths — the ones that cause this bug.
  const body = WORKFLOW.slice(WORKFLOW.indexOf('export async function transitionOrder'));
  const cancelAt = body.indexOf("canTransitionOrder(normalizedTo, 'RIDER_ASSIGNED')");
  // lastIndexOf, not indexOf: the first commit in this function is the
  // allowSame early return, which changes no status and so has nothing to
  // cancel. The commit that matters is the one after the status is written.
  const commitAt = body.lastIndexOf('if (ownsTransaction) await conn.commit()');
  assert.ok(cancelAt > -1 && commitAt > -1);
  assert.ok(cancelAt < commitAt, 'cancellation must happen before the commit');
  assert.match(WORKFLOW, /async function cancelOpenOffers\(conn,/);
});

test('a claim in progress is not cancelled out from under itself', () => {
  // claimOffer sets CLAIMED and then transitions to RIDER_ASSIGNED in one
  // transaction. The status='OPEN' guard is what keeps this hook from undoing
  // that claim a moment after it was made.
  assert.match(WORKFLOW, /WHERE order_id=\? AND status='OPEN'/);
});

test('CANCELLED is a status the table already accepts', () => {
  // No migration should be needed for this fix.
  assert.match(MIGRATION, /ENUM\('OPEN','CLAIMED','EXPIRED','CANCELLED'\)/);
});

// ─── riders are told, once each ───────────────────────────────────────────────

test('every offered rider gets their own outbox row', () => {
  // The outbox de-duplicates on event_key. One key per offer would deliver to
  // whichever rider was inserted first and drop the others without a trace.
  assert.match(WORKFLOW, /eventKey: `RIDER_OFFER_CANCELLED:\$\{offer\.id\}:\$\{recipient\.phone\}`/);
});

test('the cancellation message is dispatched, not silently dropped', () => {
  // An outbox row with no branch in sendRiderNotification would fall through to
  // offerMessage and re-advertise the job it is meant to withdraw.
  assert.match(DISPATCH, /row\.event_type\.startsWith\('RIDER_OFFER_CANCELLED'\)/);
  assert.match(DISPATCH, /text = cancelledMessage\(payload\)/);
});

test('withdrawn reads differently from lost to someone else', () => {
  // "Another rider took it" tells a rider to wait for the next one. This job is
  // not coming back, and the wording has to say so.
  const withdrawn = cancelledMessage({ jobNo: 'SNG-260820-4400' });
  assert.ok(withdrawn.includes('SNG-260820-4400'));
  assert.ok(withdrawn.includes('ยกเลิก'));
  assert.notEqual(withdrawn, takenMessage({ jobNo: 'SNG-260820-4400' }));
});

// ─── the dead card disappears ─────────────────────────────────────────────────

test('the offer list filters on the order, not just the offer', () => {
  // Filtering on delivery_offers.status alone is why the rider kept seeing a
  // job that could only fail.
  const query = CONTROLLER.slice(CONTROLLER.indexOf('async function getAvailableOffers'));
  assert.match(query, /o\.status IN \('AT_DEST_WH', 'BRANCH_RECEIVED'\)/);
});

// ─── claiming a job that has gone ─────────────────────────────────────────────

test('claimOffer checks the order before taking the offer', () => {
  const claim = DISPATCH.slice(DISPATCH.indexOf('export async function claimOffer'));
  const checkAt = claim.indexOf("canTransitionOrder(order.status, 'RIDER_ASSIGNED')");
  const takeAt  = claim.indexOf("UPDATE delivery_offers SET status='CLAIMED'");
  assert.ok(checkAt > -1, 'no order-status check');
  assert.ok(checkAt < takeAt, 'the offer must not be claimed before the order is checked');
  assert.match(claim, /reason: 'ORDER_MOVED'/);
});

test('a moved order is a refusal, not an exception', () => {
  // It used to throw from deep inside transitionOrder, which rolled the claim
  // back and surfaced a state-machine string to the rider.
  const claim = DISPATCH.slice(DISPATCH.indexOf('export async function claimOffer'));
  assert.match(claim, /return \{ won: false, reason: 'ORDER_MOVED', offer \}/);
});

test('the app answers in Thai for every refusal', () => {
  assert.match(CONTROLLER, /ORDER_MOVED:\s*'[^']*ถูกจ่ายออกไปแล้ว/);
  assert.match(CONTROLLER, /EXPIRED:\s*'[^']*หมดเวลา/);
  assert.match(CONTROLLER, /TAKEN:\s*'[^']*ไรเดอร์ท่านอื่น/);
});

test('an internal fault never reaches the rider verbatim', () => {
  // The reported alert was a raw English state-machine message. Scoped to the
  // claim handler: the other rider endpoints still forward e.message and are
  // left alone here deliberately — same defect, separate change.
  const claim = CONTROLLER.slice(CONTROLLER.indexOf('export async function claimOfferHttp'));
  const handler = claim.slice(0, claim.indexOf('\n}'));
  assert.ok(!/message: e\.message/.test(handler), 'raw error text still sent to the rider');
  assert.match(handler, /e instanceof WorkflowError \? e\.message :/);
});

test('the WhatsApp claim path has no silent exit', () => {
  // The rider typed UJYE and got nothing back — the catch returned without
  // sending. Since this handler intercepts the message before the CRM inbox,
  // saying nothing loses it entirely.
  const wa = DISPATCH.slice(DISPATCH.indexOf('export async function tryClaimFromWhatsApp'));
  const body = wa.slice(wa.indexOf('const reply'));
  assert.match(body, /catch \(e\) \{[\s\S]*await reply\(/, 'the failure path must still answer');
  assert.match(body, /res\.reason === 'ORDER_MOVED'/, 'a withdrawn job needs its own wording');
});
