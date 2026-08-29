import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import {
  extractTrackingRef,
  extractShippingInputs,
  extractProductLink,
  extractPriceQty,
} from '../../src/services/replyGroundingService.js';
import { WEIGHT_PRESETS } from '../../src/controllers/publicController.js';

const AI_SVC = readFileSync(new URL('../../src/services/aiService.js', import.meta.url), 'utf8');
const CTRL   = readFileSync(new URL('../../src/controllers/crmController.js', import.meta.url), 'utf8');
const TRACKING_CTRL = readFileSync(new URL('../../src/controllers/trackingController.js', import.meta.url), 'utf8');

// ── extractTrackingRef ───────────────────────────────────────────────────────

test('extractTrackingRef finds an SNG job number embedded in a sentence', () => {
  const result = extractTrackingRef('พัสดุเลข sng-260828-1234 ถึงไหนแล้วคะ');
  assert.deepEqual(result, { ref: 'SNG-260828-1234', kind: 'JOB' });
});

test('extractTrackingRef finds a purchase-agent quote number, case-insensitively', () => {
  const result = extractTrackingRef('เช็คให้หน่อยเลขที่ pq-20260828-0007');
  assert.deepEqual(result, { ref: 'PQ-20260828-0007', kind: 'QUOTE' });
});

test('extractTrackingRef returns null when no ref is present', () => {
  assert.equal(extractTrackingRef('ของยังไม่ถึงเลยค่ะ'), null);
});

// ── extractShippingInputs ────────────────────────────────────────────────────

test('extractShippingInputs reads real dimensions and weight when both are stated', () => {
  const result = extractShippingInputs('กล่อง 30x20x10 ซม หนัก 2kg');
  assert.deepEqual(result, { lengthCm: 30, widthCm: 20, heightCm: 10, weightKg: 2 });
});

test('extractShippingInputs falls back to a bare weight with no dimensions', () => {
  assert.deepEqual(extractShippingInputs('ของหนักประมาณ 5 กก'), { weightKg: 5 });
});

test('extractShippingInputs resolves a category keyword to its real WEIGHT_PRESETS value', () => {
  const shoesPreset = WEIGHT_PRESETS.find(p => p.key === 'shoes');
  const result = extractShippingInputs('ส่งรองเท้าคู่นึงไปลาวราคาเท่าไหร่');
  assert.deepEqual(result, { weightKg: shoesPreset.kg, presetKey: 'shoes' });
});

test('extractShippingInputs returns null when nothing shipping-related is stated', () => {
  assert.equal(extractShippingInputs('สวัสดีค่ะ'), null);
});

// ── extractProductLink ───────────────────────────────────────────────────────

test('extractProductLink matches Lazada, Shopee, and shp.ee links', () => {
  assert.equal(
    extractProductLink('อยากได้อันนี้ https://www.lazada.co.th/products/test-12345.html ค่ะ'),
    'https://www.lazada.co.th/products/test-12345.html'
  );
  assert.equal(
    extractProductLink('ดูราคาให้หน่อย shopee.co.th ยังไม่ตรง แต่ https://shopee.co.th/product-i.1.2'),
    'https://shopee.co.th/product-i.1.2'
  );
  assert.equal(extractProductLink('https://shp.ee/abc123'), 'https://shp.ee/abc123');
});

test('extractProductLink returns null for a non-shopping URL or a bare mention with no link', () => {
  assert.equal(extractProductLink('เพจ https://facebook.com/sngexpress'), null);
  assert.equal(extractProductLink('อยากซื้อของจาก shopee แต่ยังไม่มีลิงก์'), null);
});

// ── extractPriceQty ───────────────────────────────────────────────────────────

test('extractPriceQty reads a stated price and quantity', () => {
  assert.deepEqual(extractPriceQty('ราคา 500 บาท 2 ชิ้น'), { priceThb: 500, qty: 2 });
});

test('extractPriceQty defaults quantity to 1 when only a price is given', () => {
  assert.deepEqual(extractPriceQty('฿1,200'), { priceThb: 1200, qty: 1 });
});

test('extractPriceQty returns null when no price is stated', () => {
  assert.equal(extractPriceQty('อยากได้เสื้อตัวนี้ค่ะ'), null);
});

// ── Safety instruction actually reaches the prompt ───────────────────────────

test('generateSmartReplies prompt includes the no-guessing safety instruction and grounding block', () => {
  assert.match(AI_SVC, /groundingFacts\s*=\s*null/, 'generateSmartReplies must accept a groundingFacts param');
  assert.match(AI_SVC, /ห้ามสร้างหรือเดาตัวเลขราคา/, 'the literal safety instruction must be in the prompt template');
  assert.match(AI_SVC, /formatGroundingFacts\(groundingFacts\)/, 'the prompt must interpolate the formatted grounding block');
});

test('smartReplySuggestions builds grounding context before calling generateSmartReplies', () => {
  const fnBody = CTRL.slice(CTRL.indexOf('async function smartReplySuggestions'));
  const groundAt = fnBody.indexOf('buildGroundingContext(');
  const genAt = fnBody.indexOf('generateSmartReplies({');
  assert.ok(groundAt > -1 && genAt > -1, 'both calls must be present');
  assert.ok(groundAt < genAt, 'grounding must be built before generating replies');
  assert.match(fnBody.slice(genAt, genAt + 300), /groundingFacts/, 'groundingFacts must be passed through');
});

// ── trackingController regression: still resolves both ref types the same way ─

test('trackOrder resolves refs via the shared trackingLookupService, not duplicated inline logic', () => {
  assert.match(TRACKING_CTRL, /import \{ resolveTrackingRef \} from '\.\.\/services\/trackingLookupService\.js'/);
  assert.match(TRACKING_CTRL, /const \{ order, quotationId \} = await resolveTrackingRef\(ref\)/);
  assert.ok(!TRACKING_CTRL.includes('async function loadOrder('), 'the old inline loadOrder helper should be removed, not duplicated');
});
