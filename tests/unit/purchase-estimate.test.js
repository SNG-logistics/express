import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { calculatePurchaseAgentQuote } from '../../src/services/purchaseAgentPricingService.js';
import { WEIGHT_PRESETS } from '../../src/controllers/publicController.js';

/** The shape the estimator hands the page, built from the shared calculator. */
function estimate({ priceThb, qty = 1, shippingLak = 0, rate = 730, spread = 2 }) {
  const quote = calculatePurchaseAgentQuote({
    product_price_thb: priceThb,
    desired_qty: qty,
    sng_shipping_lak: shippingLak,
    exchange_rate: rate,
    fx_spread_pct: spread,
  });
  return {
    payNowLak: quote.productLak,
    payOnDeliveryLak: quote.totalLak - quote.productLak,
    totalLak: quote.totalLak,
    serviceFeeLak: quote.serviceFeeLak,
  };
}

test('the split the customer decides on always adds back to the total', () => {
  // "Pay now" and "pay on delivery" are the two numbers on screen; if they do
  // not reconstruct the total, someone is being quoted something that is not
  // what they will be charged.
  for (const priceThb of [100, 590, 2400, 19999]) {
    const e = estimate({ priceThb, shippingLak: 45000 });
    assert.equal(e.payNowLak + e.payOnDeliveryLak, e.totalLak, `price ${priceThb}`);
  }
});

test('what is asked for today is the product cost alone', () => {
  // The offer is that the customer never fronts shipping or the service fee.
  const shippingLak = 45000;
  const e = estimate({ priceThb: 1000, shippingLak });
  assert.equal(e.payOnDeliveryLak, shippingLak + e.serviceFeeLak);
});

test('the minimum service fee protects small orders, the percentage takes over on big ones', () => {
  // A 20 THB trinket must not be handled for a fee of a few hundred kip.
  const tiny = estimate({ priceThb: 20 });
  assert.equal(tiny.serviceFeeLak, 20000);
  // At ~6% the percentage passes the 20,000 floor somewhere above 45 THB.
  const big = estimate({ priceThb: 5000 });
  assert.ok(big.serviceFeeLak > 20000, 'percentage should govern a large order');
});

test('quantity multiplies the goods, and the deposit follows', () => {
  const one = estimate({ priceThb: 500 });
  const three = estimate({ priceThb: 500, qty: 3 });
  assert.equal(three.payNowLak, one.payNowLak * 3);
});

test('an estimate is never quoted below the real rate', () => {
  // The FX spread has to be applied, or every estimate comes in under the quote
  // staff later send — the one direction that makes customers feel misled.
  const withSpread = estimate({ priceThb: 1000, spread: 2 });
  const without = estimate({ priceThb: 1000, spread: 0 });
  assert.ok(withSpread.payNowLak > without.payNowLak);
});

test('every weight preset is a real, usable weight with wording in both languages', () => {
  const th = JSON.parse(readFileSync(new URL('../../src/i18n/th.json', import.meta.url)));
  const lo = JSON.parse(readFileSync(new URL('../../src/i18n/lo.json', import.meta.url)));

  assert.ok(WEIGHT_PRESETS.length >= 4, 'too few presets to cover common orders');
  for (const preset of WEIGHT_PRESETS) {
    assert.ok(preset.kg > 0, `${preset.key} has no weight`);
    const key = 'w' + preset.key.charAt(0).toUpperCase() + preset.key.slice(1);
    assert.ok(th.buy?.[key], `th.buy.${key} missing`);
    assert.ok(lo.buy?.[key], `lo.buy.${key} missing`);
  }
});

test('the estimator page is worded in both languages, with no key left behind', () => {
  const th = JSON.parse(readFileSync(new URL('../../src/i18n/th.json', import.meta.url)));
  const lo = JSON.parse(readFileSync(new URL('../../src/i18n/lo.json', import.meta.url)));
  assert.deepEqual(Object.keys(th.buy).sort(), Object.keys(lo.buy).sort());
});
