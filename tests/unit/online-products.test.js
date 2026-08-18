import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

const [routes, controller, formView, adminListView, cardView, migration, migrationRunner] = await Promise.all([
  readFile(new URL('../../src/routes/onlineProducts.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/onlineProductsController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../views/admin/products/form.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../views/admin/products/index.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../views/customer/member/online.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../database/migrate_037_online_products_photos.sql', import.meta.url), 'utf8'),
  readFile(new URL('../../scripts/migrate_db.js', import.meta.url), 'utf8'),
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
    assert.match(line, /uploadProductPhoto\.array\('photos', 6\)/);
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
  assert.match(formView, /<input[^>]+name="photos"[^>]+multiple>/);
});

test('create serializes uploaded photos and update preserves the gallery when no files are uploaded', () => {
  assert.match(controller, /getUploadedPhotoPaths\(req\.files\)/);
  assert.match(controller, /photoPaths\.length > 0 \? JSON\.stringify\(photoPaths\) : null/);
  assert.match(controller, /if \(photoPaths\.length > 0\) \{[\s\S]*setClauses\.splice\(1, 0, 'photos = \?'\)/);
  assert.doesNotMatch(controller, /req\.file\b/);
  assert.doesNotMatch(controller, /\bphoto_path\b/);
});

test('multi-photo migration is idempotent, backfills legacy covers, and is registered after 036', () => {
  assert.match(migration, /information_schema\.columns/);
  assert.match(migration, /column_name = 'photos'/);
  assert.match(migration, /ADD COLUMN photos JSON NULL/);
  assert.match(migration, /SET photos = JSON_ARRAY\(photo_path\)[\s\S]*photo_path IS NOT NULL[\s\S]*photos IS NULL/);
  assert.match(
    migrationRunner,
    /'migrate_036_online_products\.sql',\s*'migrate_037_online_products_photos\.sql'/
  );
});

test('admin views read photos defensively and use the first image as the cover', () => {
  const product = {
    id: 1,
    name: 'Gallery product',
    product_url: 'https://example.com/product',
    photos: JSON.stringify(['/uploads/products/cover.jpg', '/uploads/products/second.jpg']),
    status: 'published',
    sort_order: 0,
  };
  const formHtml = ejs.render(formView, { title: 'Edit', product, csrfToken: 'token', error: null });
  assert.match(formHtml, /name="photos"[^>]*multiple/);
  assert.match(formHtml, /src="\/uploads\/products\/cover\.jpg"/);
  assert.match(formHtml, /src="\/uploads\/products\/second\.jpg"/);

  const listHtml = ejs.render(adminListView, { products: [product], flash: null });
  assert.match(listHtml, /src="\/uploads\/products\/cover\.jpg"/);
  assert.doesNotMatch(listHtml, /src="\/uploads\/products\/second\.jpg"/);
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

test('member cards render fallback, static image, and auto-crossfade gallery branches', () => {
  const render = (product) => ejs.render(cardView, { t: key => key, products: [product] });
  const base = {
    id: 1,
    name: 'Gallery product',
    product_url: 'https://example.com/product',
    discount_pct: null,
    badge_label: null,
    platform: null,
  };

  const withoutPhotos = render({ ...base, photos: null });
  assert.match(withoutPhotos, /fa-bag-shopping/);
  assert.doesNotMatch(withoutPhotos, /<img\b/);
  assert.doesNotMatch(withoutPhotos, /x-data=/);

  const onePhoto = render({ ...base, photos: JSON.stringify(['/uploads/products/one.jpg']) });
  assert.match(onePhoto, /src="\/uploads\/products\/one\.jpg"/);
  assert.equal((onePhoto.match(/<img\b/g) || []).length, 1);
  assert.doesNotMatch(onePhoto, /x-data=/);

  const manyPhotos = render({
    ...base,
    photos: ['/uploads/products/one.jpg', '/uploads/products/two.jpg', '/uploads/products/three.jpg'],
  });
  assert.match(manyPhotos, /x-data="\{ i: 0 \}"/);
  assert.match(manyPhotos, /setInterval\(\(\) => i = \(i \+ 1\) % 3, 3000\)/);
  assert.equal((manyPhotos.match(/<img\b/g) || []).length, 3);
  for (const name of ['one', 'two', 'three']) {
    assert.match(manyPhotos, new RegExp(`src="/uploads/products/${name}\\.jpg"`));
  }

  const malformedPhotos = render({ ...base, photos: '{not-json' });
  assert.match(malformedPhotos, /fa-bag-shopping/);
  assert.doesNotMatch(malformedPhotos, /x-data=/);
});
