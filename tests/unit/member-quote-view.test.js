import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

const [memberController, partnerController, memberRoutes, requestListView, detailView] = await Promise.all([
  readFile(new URL('../../src/controllers/memberController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/partnerController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/routes/member.js', import.meta.url), 'utf8'),
  readFile(new URL('../../views/customer/member/quote-requests.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../views/customer/member/quote-detail.ejs', import.meta.url), 'utf8'),
]);

test('member quotation route is customer-authenticated and ownership-scoped', () => {
  assert.match(
    memberRoutes,
    /router\.get\('\/member\/quote-requests\/:id\/quotation', requireCustomerLogin, member\.myQuoteRequestQuotation\)/,
  );
  assert.match(memberController, /export async function myQuoteRequestQuotation/);
  assert.match(memberController, /AND pqr\.customer_account_id = \?/);
  assert.match(memberController, /pq\.status IN \('sent', 'accepted', 'ordered'\)/);
  assert.match(memberController, /res\.set\('Cache-Control', 'no-store'\)/);
});

test('member request history exposes a link only for a sent customer-visible quotation', () => {
  assert.match(memberController, /END AS quote_available/);
  assert.match(requestListView, /request\.quote_available && request\.quote_no/);
  assert.match(requestListView, /request\.quote_no && !request\.quote_available/);
  assert.match(requestListView, /\/member\/quote-requests\/<%= request\.id %>\/quotation/);

  const render = (quoteAvailable) => ejs.render(requestListView, {
    lang: 'th',
    t: (key) => key,
    requests: [{
      id: 42,
      product_name: 'Test product',
      desired_qty: 1,
      note: null,
      product_url: null,
      status: quoteAvailable ? 'quoted' : 'in_progress',
      quote_no: 'PQ-20260817-0001',
      quote_available: quoteAvailable,
      created_at: '2026-08-17T10:00:00.000Z',
    }],
  });

  assert.match(render(true), /href="\/member\/quote-requests\/42\/quotation"/);
  assert.doesNotMatch(render(false), /href="\/member\/quote-requests\/42\/quotation"/);
});

test('customer detail renders published prices without staff-only customer contact data', () => {
  const html = ejs.render(detailView, {
    lang: 'th',
    quote: {
      quote_no: 'PQ-20260817-0001',
      product_name: 'Test product',
      desired_qty: 2,
      product_url: 'https://example.test/product',
      product_price_thb: 100,
      shipping_th_thb: 20,
      subtotal_thb: 120,
      exchange_rate: 200,
      fx_spread_pct: 0,
      sng_shipping_lak: 15000,
      service_fee_lak: 5000,
      total_lak: 44000,
      note: 'Ready for review',
      status: 'sent',
      quote_created_at: '2026-08-17T10:00:00.000Z',
    },
  });

  assert.match(html, /PQ-20260817-0001/);
  assert.match(html, /44,000 LAK/);
  assert.doesNotMatch(html, /customer_phone|customer_address/);
});

test('staff publication state controls whether a linked request is visible to its customer', () => {
  assert.match(partnerController, /function quoteRequestStatusForQuotation\(status\)/);
  assert.match(partnerController, /if \(\['sent', 'accepted', 'ordered'\]\.includes\(status\)\) return 'quoted';/);
  assert.match(partnerController, /if \(status === 'cancelled'\) return 'closed';/);
  assert.match(
    partnerController,
    /UPDATE product_quote_requests SET status = \? WHERE linked_quotation_id = \?/,
  );
});
