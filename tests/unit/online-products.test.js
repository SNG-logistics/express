import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

const [routes, controller, formView, cardView] = await Promise.all([
  readFile(new URL('../../src/routes/onlineProducts.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/onlineProductsController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../views/admin/products/form.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../views/customer/member/online.ejs', import.meta.url), 'utf8'),
]);

test('member catalog route is customer-authenticated', () => {
  assert.match(routes, /router\.get\('\/member\/online', requireCustomerLogin, products\.listProducts\)/);
});

test('admin write routes are role-gated and wired through the product-photo upload middleware', () => {
  const createLine = routes.split('\n').find(l => l.includes("router.post('/admin/products',"));
  const updateLine = routes.split('\n').find(l => l.includes("router.post('/admin/products/:id',"));
  assert.ok(createLine, 'admin create route must exist');
  assert.ok(updateLine, 'admin update route must exist');
  for (const line of [createLine, updateLine]) {
    assert.match(line, /requireRole\('admin', 'manager'\)/);
    assert.match(line, /uploadProductPhoto\.single\('photo'\)/);
  }
});

test('admin list route allows staff (read-only), not just admin/manager', () => {
  const listLine = routes.split('\n').find(l => l.includes("router.get('/admin/products',"));
  assert.match(listLine, /requireRole\('admin', 'manager', 'staff'\)/);
});

test('admin form reuses the CSRF query-string pattern required for multipart POSTs', () => {
  assert.match(formView, /action="[^"]*\?_csrf=<%= encodeURIComponent\(csrfToken\) %>"/);
  assert.match(formView, /<input type="hidden" name="_csrf" value="<%= csrfToken %>">/);
  assert.match(formView, /enctype="multipart\/form-data"/);
});

test('create/update preserve the existing photo when no new file is uploaded', () => {
  assert.match(controller, /req\.file \? `\/uploads\/products\/\$\{req\.file\.filename\}` : null/);
  assert.match(controller, /req\.file \? `\/uploads\/products\/\$\{req\.file\.filename\}` : existing\?\.photo_path/);
});

test('card badge prefers discount_pct over badge_label, and falls back to nothing', () => {
  const dict = {
    online: { title: 'สินค้าออนไลน์', subtitle: 'sub', noProductsFound: 'none', discountPrefix: 'ลด', otherPlatform: 'อื่นๆ' },
  };
  const t = (key) => key.split('.').reduce((v, part) => v?.[part], dict) ?? key;

  const render = (products) => ejs.render(cardView, { t, products });

  const withDiscount = render([{ id: 1, name: 'Test A', product_url: 'https://a.example', discount_pct: 50, badge_label: 'รีวิวสูงสุด' }]);
  assert.match(withDiscount, /ลด 50%/);
  assert.doesNotMatch(withDiscount, /รีวิวสูงสุด/);

  const withLabelOnly = render([{ id: 2, name: 'Test B', product_url: 'https://b.example', discount_pct: null, badge_label: 'รีวิวสูงสุด' }]);
  assert.match(withLabelOnly, /รีวิวสูงสุด/);

  const withNeither = render([{ id: 3, name: 'Test C', product_url: 'https://c.example', discount_pct: null, badge_label: null }]);
  assert.doesNotMatch(withNeither, /fa-tag/);

  // Every card must link straight out to the real listing, not an internal route.
  assert.match(withDiscount, /href="https:\/\/a\.example"/);
  assert.match(withDiscount, /target="_blank"/);
  assert.match(withDiscount, /rel="noopener"/);
});

test('empty state renders without leaking a raw i18n key', () => {
  const dict = {
    online: { title: 'สินค้าออนไลน์', subtitle: 'sub', noProductsFound: 'ยังไม่มีสินค้าแนะนำตอนนี้', discountPrefix: 'ลด', otherPlatform: 'อื่นๆ' },
  };
  const t = (key) => key.split('.').reduce((v, part) => v?.[part], dict) ?? key;
  const html = ejs.render(cardView, { t, products: [] });
  assert.match(html, /ยังไม่มีสินค้าแนะนำตอนนี้/);
  assert.doesNotMatch(html, /online\.noProductsFound/);
});
