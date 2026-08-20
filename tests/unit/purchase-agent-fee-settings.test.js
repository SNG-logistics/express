import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import {
  feeSetting, calculatePurchaseAgentQuote,
  PURCHASE_AGENT_FEE_MIN_LIMIT_LAK, PURCHASE_AGENT_FEE_PCT_DEFAULT,
} from '../../src/services/purchaseAgentPricingService.js';

const PUBLIC_CTRL  = readFileSync(new URL('../../src/controllers/publicController.js', import.meta.url), 'utf8');
const PARTNER_CTRL = readFileSync(new URL('../../src/controllers/partnerController.js', import.meta.url), 'utf8');
const SETTINGS_CTRL = readFileSync(new URL('../../src/controllers/settingsController.js', import.meta.url), 'utf8');
const SETTINGS_ROUTES = readFileSync(new URL('../../src/routes/settings.js', import.meta.url), 'utf8');
const NEW_QUOTE = readFileSync(new URL('../../views/partner/quotes/new.ejs', import.meta.url), 'utf8');
const BUY_VIEW  = readFileSync(new URL('../../views/customer/buy.ejs', import.meta.url), 'utf8');
const PANEL      = readFileSync(new URL('../../views/settings/_panel_purchase_agent.ejs', import.meta.url), 'utf8');
const MEMBER_SETTINGS = readFileSync(new URL('../../views/settings/member.ejs', import.meta.url), 'utf8');
const th = JSON.parse(readFileSync(new URL('../../src/i18n/th.json', import.meta.url)));
const lo = JSON.parse(readFileSync(new URL('../../src/i18n/lo.json', import.meta.url)));

// ─── the falsy-zero trap ────────────────────────────────────────────────────
// `Number(x) || fallback` cannot express a deliberate zero — the exact bug
// that once made a free delivery zone impossible to save, and would have made
// a free purchase-agent promotion impossible too.

test('a fee saved as 0 stays 0, not the default', () => {
  assert.equal(feeSetting('0', PURCHASE_AGENT_FEE_MIN_LIMIT_LAK), 0);
  assert.equal(feeSetting(0, PURCHASE_AGENT_FEE_PCT_DEFAULT), 0);
});

test('blank, missing, or invalid falls back to the default — 0 does not', () => {
  assert.equal(feeSetting(undefined, 20000), 20000);
  assert.equal(feeSetting(null, 20000), 20000);
  assert.equal(feeSetting('', 20000), 20000);
  assert.equal(feeSetting('   ', 20000), 20000);
  assert.equal(feeSetting('not-a-number', 20000), 20000);
  assert.equal(feeSetting('-5', 20000), 20000, 'a negative fee is invalid, not a discount');
});

test('a normal configured fee still comes through unchanged', () => {
  assert.equal(feeSetting('15000', 20000), 15000);
  assert.equal(feeSetting('4.5', 6), 4.5);
});

test('both fee settings read through feeSetting, not the old || pattern', () => {
  for (const src of [PUBLIC_CTRL, PARTNER_CTRL]) {
    assert.ok(!/purchase_agent_fee_min_lak \|\| 20000/.test(src), 'old falsy-zero pattern still present');
    assert.ok(!/purchase_agent_fee_pct \|\| 6/.test(src), 'old falsy-zero pattern still present');
  }
});

test('a quote with both fees at zero is genuinely free, not floored at the default', () => {
  const quote = calculatePurchaseAgentQuote({
    product_price_thb: 1000, exchange_rate: 730, fee_min_lak: 0, fee_pct: 0,
  });
  assert.equal(quote.serviceFeeLak, 0);
});

// ─── currency: shipping_rates.price is baht, not kip ───────────────────────
// The settings screen that maintains it is labelled (THB) and prefixed ฿; a
// ฿25 cross-border leg was being added straight into a kip total, so it
// appeared as "25" beside a nearly 500,000-kip bill and vanished from the
// price the customer actually pays.

test('the public estimator converts shipping THB to LAK before pricing', () => {
  assert.match(PUBLIC_CTRL, /getLatestRate\(pool, 'THB_LAK'\)/);
  assert.match(PUBLIC_CTRL, /shippingLak = Math\.ceil\(\(shipping\.price \|\| 0\) \* rate\)/);
  // The unconverted baht figure must not be the one sent to the pricing
  // service or back to the customer.
  assert.ok(!/sng_shipping_lak: shipping\.price \|\| 0/.test(PUBLIC_CTRL),
    'raw baht shipping price still passed as if it were kip');
});

test('the staff quote form converts the suggested shipping fee the same way', () => {
  const fn = NEW_QUOTE.slice(NEW_QUOTE.indexOf('async fetchAutoShipping'));
  const body = fn.slice(0, fn.indexOf('},'));
  assert.match(body, /Math\.ceil\(d\.price \* rate\)/);
  assert.ok(!/this\.autoSngLak = d\.price;/.test(body), 'raw baht price still offered as the LAK suggestion');
});

test('the conversion never applies the FX spread', () => {
  // This is SNG's own charge, not money being exchanged for the customer —
  // the spread belongs to the product-cost conversion only.
  const ctrlSnippet = PUBLIC_CTRL.slice(PUBLIC_CTRL.indexOf('shippingLak = Math.ceil'));
  assert.ok(!/spread/i.test(ctrlSnippet.slice(0, 80)));
});

// ─── the settings panel ─────────────────────────────────────────────────────

test('the fee is configurable from the member settings hub, not just the database', () => {
  assert.match(SETTINGS_ROUTES, /router\.post\('\/settings\/purchase-agent'.*settings\.updatePurchaseAgentSettings/);
  assert.match(SETTINGS_CTRL, /export async function updatePurchaseAgentSettings/);
  assert.match(MEMBER_SETTINGS, /_panel_purchase_agent/);
});

test('the update handler rejects a blank field instead of silently zeroing it', () => {
  const fn = SETTINGS_CTRL.slice(SETTINGS_CTRL.indexOf('export async function updatePurchaseAgentSettings'));
  assert.match(fn, /String\(raw\)\.trim\(\) === ''/);
  assert.match(fn, /กรุณากรอก/);
});

test('the update handler rejects a negative fee', () => {
  const fn = SETTINGS_CTRL.slice(SETTINGS_CTRL.indexOf('export async function updatePurchaseAgentSettings'));
  assert.match(fn, /value < 0/);
});

test('saving both fees at zero is announced as a promotion, not a silent 0', () => {
  const fn = SETTINGS_CTRL.slice(SETTINGS_CTRL.indexOf('export async function updatePurchaseAgentSettings'));
  assert.match(fn, /feeMin === 0 && feePct === 0/);
  assert.match(fn, /ฟรีค่าบริการ/);
});

// ─── customer-facing wording ─────────────────────────────────────────────────

test('a zero service fee reads as "free" on the estimator, not "0 LAK"', () => {
  assert.match(BUY_VIEW, /setService/);
  assert.match(BUY_VIEW, /value > 0 \? fmt\.format\(Math\.round\(value\)\) : freeLabel/);
  assert.ok(!/set\('rowService', data\.serviceFeeLak\)/.test(BUY_VIEW),
    'the raw setter is still wired up, bypassing the free-fee wording');
});

test('the free-fee wording exists in both languages', () => {
  assert.ok(th.buy?.rowServiceFree, 'th.buy.rowServiceFree missing');
  assert.ok(lo.buy?.rowServiceFree, 'lo.buy.rowServiceFree missing');
});

test('the estimator page still has no untranslated key between the two languages', () => {
  assert.deepEqual(Object.keys(th.buy).sort(), Object.keys(lo.buy).sort());
});

test('the settings panel shows a sample fee so "6% or 20,000, whichever is more" is a real number', () => {
  assert.match(PANEL, /Math\.max\(min, sample \* pct \/ 100\)/);
});

test('the settings panel flags when the promotion is currently live', () => {
  assert.match(PANEL, /isFree/);
  assert.match(PANEL, /minValue === 0 && pctValue === 0/);
});
