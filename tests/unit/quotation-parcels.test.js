import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveSupplierStage,
  parcelProgress,
  PARCEL_STATUSES,
} from '../../src/services/quotationParcelService.js';

const box = status => ({ status });

test('the Thai leg is only as far along as its slowest box', () => {
  assert.equal(deriveSupplierStage([box('PENDING'), box('PENDING')]), 'purchased');
  // One box moving is enough to tell the customer the seller has started.
  assert.equal(deriveSupplierStage([box('SHIPPED'), box('PENDING')]), 'supplier_shipped');
  // But arrival is not claimed until every box is actually in the warehouse.
  assert.equal(deriveSupplierStage([box('AT_TH_HUB'), box('SHIPPED')]), 'supplier_shipped');
  assert.equal(deriveSupplierStage([box('AT_TH_HUB'), box('PENDING')]), 'supplier_shipped');
  assert.equal(deriveSupplierStage([box('AT_TH_HUB'), box('AT_TH_HUB')]), 'at_th_hub');
});

test('a lost box does not hold the whole order open forever', () => {
  // The business claims for the missing box and ships the rest; without
  // excluding it, the order could never reach at_th_hub.
  assert.equal(deriveSupplierStage([box('AT_TH_HUB'), box('LOST')]), 'at_th_hub');
  assert.equal(deriveSupplierStage([box('SHIPPED'), box('LOST')]), 'supplier_shipped');
});

test('an order where everything is lost has not arrived', () => {
  // Nothing is in the warehouse, so it must not read as ready to cross the
  // border just because no box is still outstanding.
  assert.equal(deriveSupplierStage([box('LOST'), box('LOST')]), 'purchased');
});

test('a quotation with no boxes recorded yet stays put', () => {
  assert.equal(deriveSupplierStage([]), 'purchased');
  assert.equal(deriveSupplierStage(null), 'purchased');
  assert.equal(deriveSupplierStage(undefined), 'purchased');
});

test('progress counts what the customer is told, with lost boxes off the denominator', () => {
  const parcels = [box('AT_TH_HUB'), box('AT_TH_HUB'), box('SHIPPED'), box('LOST')];
  assert.deepEqual(parcelProgress(parcels), {
    total: 4, expected: 3, shipped: 1, arrived: 2, lost: 1,
  });
});

test('progress on an empty order does not divide by anything', () => {
  assert.deepEqual(parcelProgress([]), { total: 0, expected: 0, shipped: 0, arrived: 0, lost: 0 });
  assert.deepEqual(parcelProgress(null), { total: 0, expected: 0, shipped: 0, arrived: 0, lost: 0 });
});

test('every parcel status is handled by the stage derivation', () => {
  // A status nobody accounted for would silently fall through to 'purchased'
  // and freeze the order, so each one must produce a defensible stage.
  const expected = {
    PENDING: 'purchased',
    SHIPPED: 'supplier_shipped',
    AT_TH_HUB: 'at_th_hub',
    LOST: 'purchased',
  };
  for (const status of PARCEL_STATUSES) {
    assert.equal(deriveSupplierStage([box(status)]), expected[status], status);
  }
});

// ── Phase 2: the derived stages inside the quotation status machine ──────────
import { canTransitionQuotation, getNextQuotationStatuses } from '../../src/constants/transitions.js';
import { buildPurchaseAgentMessage } from '../../src/services/purchaseAgentNotificationService.js';

test('the Thai-leg stages can be skipped entirely', () => {
  // An order whose boxes nobody recorded must still be able to become a
  // shipment, or forgetting to fill the form would strand the quotation.
  assert.equal(canTransitionQuotation('purchased', 'ordered'), true);
});

test('a mis-marked box can walk the stage back, but nothing walks back out of ordered', () => {
  // deriveSupplierStage recomputes from the boxes, so correcting one that was
  // marked arrived by mistake lowers the stage; refusing that would leave the
  // quotation permanently overstating where the goods are.
  assert.equal(canTransitionQuotation('at_th_hub', 'supplier_shipped'), true);
  assert.equal(canTransitionQuotation('at_th_hub', 'purchased'), true);
  assert.equal(canTransitionQuotation('supplier_shipped', 'purchased'), true);
  // Once a real shipment exists there is no going back.
  assert.equal(canTransitionQuotation('ordered', 'at_th_hub'), false);
  assert.equal(canTransitionQuotation('ordered', 'purchased'), false);
});

test('the Thai leg runs forward in order', () => {
  assert.equal(canTransitionQuotation('purchased', 'supplier_shipped'), true);
  assert.equal(canTransitionQuotation('supplier_shipped', 'at_th_hub'), true);
  // Still no jumping into the leg from before the goods were bought.
  assert.equal(canTransitionQuotation('accepted', 'supplier_shipped'), false);
  assert.equal(canTransitionQuotation('purchasing', 'at_th_hub'), false);
});

test('cancelling stays available throughout the Thai leg', () => {
  for (const stage of ['purchased', 'supplier_shipped', 'at_th_hub']) {
    assert.ok(getNextQuotationStatuses(stage).includes('cancelled'), stage);
  }
});

test('both new stages have a customer message, and it never leaks the shop', () => {
  const shipped = buildPurchaseAgentMessage('PURCHASE_AGENT:SUPPLIER_SHIPPED', {
    quoteNo: 'PQ-20260819-0001', productName: 'ตุ๊กตา', shipped: 2, expected: 3,
  });
  const arrived = buildPurchaseAgentMessage('PURCHASE_AGENT:AT_TH_HUB', {
    quoteNo: 'PQ-20260819-0001', productName: 'ตุ๊กตา', arrived: 3, expected: 3,
  });

  for (const text of [shipped, arrived]) {
    assert.ok(text, 'template missing');
    assert.ok(text.includes('PQ-20260819-0001'));
    // The owner's decision: customers never see the platform or its tracking.
    assert.doesNotMatch(text, /lazada|shopee|lex|flash|kerry|j&t/i);
  }
  assert.match(shipped, /2\/3/);
  assert.match(arrived, /3\/3/);
});

test('a single-box order is not told about box counts', () => {
  // "1/1 boxes" is noise; the counts only earn their place when a split happened.
  const text = buildPurchaseAgentMessage('PURCHASE_AGENT:AT_TH_HUB', {
    quoteNo: 'PQ-1', productName: 'ตุ๊กตา', arrived: 1, expected: 1,
  });
  assert.doesNotMatch(text, /1\/1/);
});
