import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { escalateToDispatchMessage, expiredMessage, timedOutMessage } from '../../src/services/riderOfferMessages.js';

const DISPATCH = readFileSync(new URL('../../src/services/riderDispatchService.js', import.meta.url), 'utf8');

// Confirmed with the owner: recipients are every active admin/manager/
// dispatcher user's own users.phone — no new "dispatch hotline" setting.

test('expireStaleOffers looks up dispatch-capable staff once, not per offer', () => {
  const fn = DISPATCH.slice(DISPATCH.indexOf('export async function expireStaleOffers'));
  const body = fn.slice(0, fn.indexOf('\n  let expired = 0;'));
  assert.match(body, /role IN \('admin','manager','dispatcher'\)/);
  assert.match(body, /status='active'/);
  assert.match(body, /phone IS NOT NULL AND phone != ''/);
});

test('only an HQ-direct order (no branch) escalates to dispatch', () => {
  const fn = DISPATCH.slice(DISPATCH.indexOf('export async function expireStaleOffers'));
  const body = fn.slice(0, fn.indexOf('\n  return expired;'));
  const branchCheckAt = body.indexOf('if (!o.branch_id)');
  const escalateAt = body.indexOf("eventType: `RIDER_OFFER_ESCALATE:${o.id}`");
  assert.ok(branchCheckAt > -1 && escalateAt > -1, 'missing the branch_id guard or the escalate call');
  assert.ok(branchCheckAt < escalateAt, 'the escalate call must sit inside the branch_id guard');
});

test('each dispatch-capable staff member gets their own outbox row', () => {
  // Same de-duplication reasoning as the rider notices above it: one shared
  // key would deliver to whichever staff member's row landed first and drop
  // the rest silently.
  assert.match(DISPATCH, /eventKey: `RIDER_OFFER_ESCALATE:\$\{o\.id\}:\$\{staff\.id\}`/);
});

test('sendRiderNotification routes RIDER_OFFER_ESCALATE through its own message', () => {
  assert.match(DISPATCH, /RIDER_OFFER_ESCALATE[\s\S]{0,40}text = escalateToDispatchMessage\(payload\)/);
});

test('the escalation wording is distinct from the branch and rider timeout wording', () => {
  const msg = escalateToDispatchMessage({ jobNo: 'SNG-260820-9001' });
  assert.ok(msg.includes('SNG-260820-9001'));
  assert.ok(msg.includes('มอบหมายไรเดอร์ด้วยตนเอง'));
  assert.notEqual(msg, expiredMessage({ jobNo: 'SNG-260820-9001' }));
  assert.notEqual(msg, timedOutMessage({ jobNo: 'SNG-260820-9001' }));
});
