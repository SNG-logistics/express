import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { OPEN_FOR_LOCATION } from '../../src/services/receiverLocationService.js';

const WORKFLOW = readFileSync(new URL('../../src/services/orderWorkflowService.js', import.meta.url), 'utf8');
const BACKFILL = readFileSync(new URL('../../scripts/backfill_open_order_locations.mjs', import.meta.url), 'utf8');

// Bug report: a customer shared two WhatsApp location pins for an in-flight
// order, but the rider's job screen still fell back to a text-address
// search instead of real map directions. Root cause: saveCustomerLocation
// only copies a pin onto orders that are already "open for location" at the
// exact moment it arrives — an order still crossing the border when the pin
// comes in never picks it up later, even once it reaches AT_DEST_WH.

test('OPEN_FOR_LOCATION is exported so callers outside the service can reuse the same list', () => {
  assert.ok(Array.isArray(OPEN_FOR_LOCATION) && OPEN_FOR_LOCATION.length > 0);
  assert.ok(OPEN_FOR_LOCATION.includes('AT_DEST_WH'));
});

test('transitionOrder catches an order up on AT_DEST_WH entry', () => {
  const body = WORKFLOW.slice(WORKFLOW.indexOf("if (ownsTransaction && normalizedTo === 'AT_DEST_WH') {"));
  const catchupAt = body.indexOf("normalizedTo === 'AT_DEST_WH' && order.receiver_id");
  const callAt = body.indexOf('applySavedLocationToOrder(orderId, order.receiver_id)');
  assert.ok(catchupAt > -1 && callAt > -1, 'missing the location catch-up hook');
  assert.ok(catchupAt < callAt);
});

test('the location catch-up runs from receiverLocationService, not a new copy of the logic', () => {
  assert.match(WORKFLOW, /import\('\.\/receiverLocationService\.js'\)/);
});

test('a failure in the catch-up hook is caught, never left to reject unhandled', () => {
  const fn = WORKFLOW.slice(WORKFLOW.indexOf("normalizedTo === 'AT_DEST_WH' && order.receiver_id"));
  const body = fn.slice(0, fn.indexOf('\n    return { order,'));
  assert.match(body, /\.catch\(err => console\.error/);
});

// ─── One-off backfill for orders already stuck without coordinates ────────────

test('the backfill script only targets orders currently open for location and missing coordinates', () => {
  assert.match(BACKFILL, /status IN \(\$\{placeholders\}\)/);
  assert.match(BACKFILL, /receiver_lat IS NULL OR receiver_lng IS NULL/);
});

test('the backfill script reuses applySavedLocationToOrder rather than duplicating the query', () => {
  assert.match(BACKFILL, /import \{ applySavedLocationToOrder, OPEN_FOR_LOCATION \} from '\.\.\/src\/services\/receiverLocationService\.js'/);
  assert.match(BACKFILL, /await applySavedLocationToOrder\(order\.id, order\.receiver_id\)/);
});

test('the backfill script is safe to re-run — it never touches an order that already has coordinates', () => {
  // Combined with applySavedLocationToOrder itself being a no-op when the
  // customer has no usable pin, running this twice just does nothing the
  // second time.
  assert.match(BACKFILL, /AND \(receiver_lat IS NULL OR receiver_lng IS NULL\)/);
});
