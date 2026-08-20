import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { canTransitionOrder } from '../../src/constants/transitions.js';

const APP     = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');
const ORDERS_VIEW = readFileSync(new URL('../../views/orders/detail.ejs', import.meta.url), 'utf8');
const CRM_INBOX    = readFileSync(new URL('../../views/crm/inbox.ejs', import.meta.url), 'utf8');
const CRM_CUSTOMERS = readFileSync(new URL('../../views/crm/customers.ejs', import.meta.url), 'utf8');
const ORDERS_ROUTES = readFileSync(new URL('../../src/routes/orders.js', import.meta.url), 'utf8');

// ─── Four dead `can.*` flags — always false, always-hidden UI ────────────────
// A role-permission audit found these referenced in views but never defined
// in res.locals.can, so the elements they gate could never render for
// anyone — not even admin. Two had a correctly-named flag already sitting
// unused right next to them; one needed adding.

test('orders/detail.ejs uses the real processCustoms flag, not the undefined manageCustoms', () => {
  assert.ok(!/can\.manageCustoms/.test(ORDERS_VIEW), 'the dead flag name must not remain');
  assert.match(ORDERS_VIEW, /can\.processCustoms/);
});

test('crm/inbox.ejs uses the real useInbox flag, not the undefined agentCrm', () => {
  assert.ok(!/can\.agentCrm/.test(CRM_INBOX));
  assert.match(CRM_INBOX, /can\.useInbox/);
});

test('crm/customers.ejs uses the real manageCrm flag, not the undefined crmAdmin', () => {
  assert.ok(!/can\.crmAdmin/.test(CRM_CUSTOMERS));
  assert.match(CRM_CUSTOMERS, /can\.manageCrm/);
});

test('can.resolveFlag now exists and matches the resolve-flag route exactly', () => {
  assert.match(APP, /resolveFlag:\s*has\('admin','manager','dispatcher','warehouse_th'\)/);
  assert.match(ORDERS_ROUTES, /flags\/:flagId\/resolve[\s\S]{0,80}requireRole\(\['admin','manager','dispatcher','warehouse_th'\]\)/);
});

// ─── receiveOrder route guard was missing warehouse_la ────────────────────────
// The handler itself already branches on warehouse_la for LA_TO_TH orders
// (checked directly in ordersController.receiveOrder), but the route guard
// never let a warehouse_la user past requireRole to reach that logic.

test('the receive route now includes warehouse_la, matching what the handler already does', () => {
  const routeBlock = ORDERS_ROUTES.slice(
    ORDERS_ROUTES.indexOf("router.post('/orders/:id/receive'"),
    ORDERS_ROUTES.indexOf('orders.receiveOrder)') + 'orders.receiveOrder)'.length
  );
  assert.match(routeBlock, /requireRole\(\['admin','manager','dispatcher','warehouse_th','warehouse_la'\]\)/);
});

// ─── ARRIVED_BORDER_WH → CUSTOMS_HOLD was a dead edge ─────────────────────────
// customsModel.js's CUSTOMS_ELIGIBLE_STATUSES and its own header comment both
// document this as a valid entry point, but the transitions graph never
// allowed it — so calling startClearance on an order already at
// ARRIVED_BORDER_WH always threw a 409, no matter what the UI offered.

test('customs can now be started from ARRIVED_BORDER_WH, not just CROSSING_BORDER', () => {
  assert.equal(canTransitionOrder('CROSSING_BORDER', 'CUSTOMS_HOLD'), true);
  assert.equal(canTransitionOrder('ARRIVED_BORDER_WH', 'CUSTOMS_HOLD'), true);
});

test('the loop back out still closes correctly', () => {
  // CUSTOMS_HOLD -> CUSTOMS_CLEARED -> ARRIVED_BORDER_WH already existed;
  // adding the new entry edge must not have disturbed it.
  assert.equal(canTransitionOrder('CUSTOMS_HOLD', 'CUSTOMS_CLEARED'), true);
  assert.equal(canTransitionOrder('CUSTOMS_CLEARED', 'ARRIVED_BORDER_WH'), true);
});

test('ARRIVED_BORDER_WH still cannot skip straight to AT_DEST_WH via a bogus edge removal', () => {
  // Guard against a careless edit accidentally replacing rather than
  // extending the original single-edge array.
  assert.equal(canTransitionOrder('ARRIVED_BORDER_WH', 'AT_DEST_WH'), true);
});
