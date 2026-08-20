import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

const DETAIL = readFileSync(new URL('../../views/orders/detail.ejs', import.meta.url), 'utf8');
const ORDERS = readFileSync(new URL('../../src/controllers/ordersController.js', import.meta.url), 'utf8');

// ─── dispatcher: route-permitted, previously no UI ─────────────────────────
// Confirmed with the owner: dispatcher gets the UI, matching what the routes
// in src/routes/orders.js already allow (edit, receive, arrived-dest,
// delivery/delivered/failed, dest-office all list dispatcher).

test('canEdit now includes dispatcher, matching POST /orders/:id/edit', () => {
  assert.match(DETAIL, /const canEdit\s*=\s*!isLocked && \['NEW','RECEIVED_WH_TH','RECEIVED_WH_LA'\]\.includes\(order\.status\) && isDispatch/);
});

test('canReceive now includes dispatcher for either direction', () => {
  const block = DETAIL.slice(DETAIL.indexOf('const canReceive'), DETAIL.indexOf('const canStartDelivery'));
  assert.match(block, /isDispatch \|\| \(isTH2LA && isTH_WH\) \|\| \(!isTH2LA && isLA_WH\)/);
});

test('the ARRIVED_BORDER_WH action now includes dispatcher', () => {
  assert.match(DETAIL, /order\.status === 'ARRIVED_BORDER_WH' && \(isLA_WH \|\| isDispatch\)/);
});

// ─── AT_DEST_WH split: driver_support gets start-delivery, not dest-office ──

test('canStartDelivery matches ROLES_DELIVERY_WRITE (includes driver_support)', () => {
  assert.match(DETAIL, /const canStartDelivery = !isLocked && order\.status === 'AT_DEST_WH' &&\s*\(isLA_WH \|\| isDispatch \|\| role === 'driver_support'\)/);
});

test('canDestOffice matches ROLES_DEST_OFFICE (excludes driver_support)', () => {
  const block = DETAIL.slice(DETAIL.indexOf('const canDestOffice'), DETAIL.indexOf('const canDeliver ='));
  assert.match(block, /isLA_WH \|\| isDispatch/);
  assert.ok(!/driver_support/.test(block), 'driver_support must not reach the dest-office buttons — their route rejects them');
});

test('the start-delivery button and dest-office buttons are gated independently in the template', () => {
  const block = DETAIL.slice(DETAIL.indexOf("} else if (canDeliver) {"), DETAIL.indexOf("} else if (order.status === 'OUT_FOR_DELIVERY'"));
  assert.match(block, /if \(canStartDelivery\) \{/);
  assert.match(block, /if \(canDestOffice\) \{/);
});

// ─── OUT_FOR_DELIVERY: dispatcher + driver_support ─────────────────────────

test('the deliver/fail buttons now include dispatcher and driver_support', () => {
  assert.match(DETAIL, /order\.status === 'OUT_FOR_DELIVERY' && \(isLA_WH \|\| isDispatch \|\| role === 'driver_support'\)/);
});

// ─── the COD gap: markDelivered never captured what was collected ─────────
// riderController.deliverJob and branchesController.markDelivered both
// record cod_collected_amount at the door; this form (used by dispatcher/
// warehouse_la/driver_support) had no field for it at all, so a real COD
// collection here never reached accounting.

test('the deliver modal now has a COD field, only when the order actually has COD', () => {
  const modal = DETAIL.slice(DETAIL.indexOf('id="deliverModal"'), DETAIL.indexOf('id="failModal"'));
  assert.match(modal, /Number\(order\.cod_amount\) > 0/);
  assert.match(modal, /name="cod_collected"/);
});

test('markDelivered now validates and records the collected COD', () => {
  const fn = ORDERS.slice(ORDERS.indexOf('export async function markDelivered'));
  const body = fn.slice(0, fn.indexOf('\nexport async function markDeliveryFailed'));
  assert.match(body, /const codCollected = Number\(req\.body\.cod_collected \|\| 0\)/);
  assert.match(body, /ยอด COD ต้องเท่ากับ/);
  assert.match(body, /cod_collected_amount: codCollected/);
});

test('markDelivered moves a paid order on to COD_COLLECTED, leaving remittance to finance', () => {
  const fn = ORDERS.slice(ORDERS.indexOf('export async function markDelivered'));
  const body = fn.slice(0, fn.indexOf('\nexport async function markDeliveryFailed'));
  assert.match(body, /toStatus: 'COD_COLLECTED'/);
  assert.match(body, /notify: false/);
});

test('markDelivered still logs delivery_events inside the same transaction', () => {
  const fn = ORDERS.slice(ORDERS.indexOf('export async function markDelivered'));
  const body = fn.slice(0, fn.indexOf('\nexport async function markDeliveryFailed'));
  const txAt = body.indexOf('await withTransaction(async (conn)');
  const logAt = body.indexOf('await logEvent(');
  assert.ok(txAt > -1 && logAt > -1 && txAt < logAt, 'logEvent must run inside the transaction, not after it');
});
