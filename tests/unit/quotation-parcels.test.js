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
