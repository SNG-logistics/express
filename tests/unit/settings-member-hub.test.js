import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';

const [routes, controller, sidebar, memberView] = await Promise.all([
  readFile(new URL('../../src/routes/settings.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/settingsController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../views/components/sidebar.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../views/settings/member.ejs', import.meta.url), 'utf8'),
]);

test('the member settings hub route exists with the broadest applicable role gate', () => {
  assert.match(
    routes,
    /router\.get\('\/settings\/member', requireLogin, requireRole\('admin', 'manager', 'staff'\), settings\.showMemberSettings\)/
  );
});

test('showMemberSettings gathers every tab\'s data in one pass, reusing existing queries', () => {
  assert.match(controller, /export async function showMemberSettings/);
  assert.match(controller, /SELECT \* FROM shipping_rates WHERE active = 1/);
  assert.match(controller, /FROM exchange_rates er LEFT JOIN users/);
  assert.match(controller, /getCompanySettings\(\)/);
  assert.match(controller, /listAllProhibitedItems\(\)/);
  assert.match(controller, /listAllTestimonials\(\)/);
  assert.match(controller, /FROM online_products ORDER BY sort_order/);
  assert.match(controller, /FROM directory_shops s/);
  assert.match(controller, /res\.render\('settings\/member'/);
});

test('write actions redirect back into the hub, not the old scattered pages', () => {
  assert.match(controller, /res\.redirect\('\/settings\/member#rates'\)/);
  assert.match(controller, /res\.redirect\('\/settings\/member#fx'\)/);
  assert.match(controller, /res\.redirect\('\/settings\/member#banner'\)/);
  assert.match(controller, /res\.redirect\('\/settings\/member#company'\)/);
  assert.match(controller, /res\.redirect\('\/settings\/member#prohibited'\)/);
  assert.match(controller, /res\.redirect\('\/settings\/member#testimonials'\)/);
  // Danger Zone (clear-test-data) is deliberately NOT part of the customer-UI
  // hub, so it keeps redirecting to the standalone rates page.
  assert.match(controller, /res\.redirect\('\/settings\/rates'\)/);
});

test('sidebar links the hub once, under its own section, instead of the old scattered entries', () => {
  assert.match(sidebar, /href="\/settings\/member"/);
  assert.match(sidebar, /ตั้งค่าหน้า Member/);
  assert.doesNotMatch(sidebar, /href="\/admin\/products"/);
  assert.doesNotMatch(sidebar, /href="\/settings\/rates"/);
});

test('the hub page renders all 8 tabs with real data, including the products/shops list tables', () => {
  const html = ejs.render(memberView, {
    user: { role: 'admin' },
    csrfToken: 'token',
    flash: null,
    rates: [{ id: 1, name: '1-5 Kg', max_weight: 5, max_dimension: 100, price: 150, price_per_kg: 0 }],
    fxRates: [],
    company: {},
    banned: [],
    askFirst: [],
    testimonialRows: [],
    products: [{ id: 1, name: 'Test product', product_url: 'https://a.example', photos: null, status: 'draft' }],
    shops: [{ id: 1, name: 'Test shop', business_type: 'ทั่วไป', status: 'draft' }],
  }, {
    filename: fileURLToPath(new URL('../../views/settings/member.ejs', import.meta.url)),
  });

  for (const label of ['อัตราค่าส่ง', 'อัตราแลกเปลี่ยน', 'แบนเนอร์หน้าแรก', 'ข้อมูลบริษัท',
    'ของที่รับ/ไม่รับ', 'หลักฐานจากลูกค้า', 'สินค้าออนไลน์', 'ร้านค้า']) {
    assert.match(html, new RegExp(label), `missing tab label: ${label}`);
  }
  assert.match(html, /1-5 Kg/);
  assert.match(html, /Test product/);
  assert.match(html, /Test shop/);
});

test('non-office-admin roles never see the company tab (its content is gated inside the panel)', () => {
  const html = ejs.render(memberView, {
    user: { role: 'staff' },
    csrfToken: 'token',
    flash: null,
    rates: [],
    fxRates: [],
    company: {},
    banned: [],
    askFirst: [],
    testimonialRows: [],
    products: [],
    shops: [],
  }, {
    filename: fileURLToPath(new URL('../../views/settings/member.ejs', import.meta.url)),
  });
  assert.doesNotMatch(html, /setTab\('company'\)/);
});
