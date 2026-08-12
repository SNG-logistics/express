import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRatePrice, parseDimensionSum, resolveShippingRate } from '../../src/services/pricingService.js';

test('server pricing combines base price and chargeable kilograms', () => {
  assert.equal(computeRatePrice({ price: '30.00', price_per_kg: '2.50' }, 4), 40);
  assert.equal(computeRatePrice({ price: '30.00' }, 99), 30);
});

test('dimension parser accepts LxWxH and rejects malformed input', () => {
  assert.equal(parseDimensionSum('10x20x30'), 60);
  assert.equal(parseDimensionSum(''), 0);
  assert.throws(() => parseDimensionSum('10x20'), /Invalid parcel dimensions/);
});

test('rate resolver rejects weight over the selected server-side limit', async () => {
  const conn = {
    async query() {
      return [[{
        id: 1,
        name: 'Small',
        max_weight: '2.00',
        max_dimension: 100,
        price: '30.00',
        price_per_kg: '0.00',
        active: 1,
      }]];
    },
  };
  await assert.rejects(
    resolveShippingRate(conn, { rateId: 1, chargeableKg: 3, dimensionSum: 30 }),
    error => error.code === 'RATE_WEIGHT_EXCEEDED'
  );
});
