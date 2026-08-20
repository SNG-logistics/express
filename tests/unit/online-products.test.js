import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';

const [routes, controller, formView, adminListView, listTableView, cardView, migration, migrationRunner, pricingMigration] = await Promise.all([
  readFile(new URL('../../src/routes/onlineProducts.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/onlineProductsController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../views/admin/products/form.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../views/admin/products/index.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../views/admin/products/_list_table.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../views/customer/member/online.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../database/migrate_037_online_products_photos.sql', import.meta.url), 'utf8'),
  readFile(new URL('../../scripts/migrate_db.js', import.meta.url), 'utf8'),
  readFile(new URL('../../database/migrate_045_online_products_pricing.sql', import.meta.url), 'utf8'),
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

  const listHtml = ejs.render(adminListView, { products: [product], flash: null }, {
    filename: fileURLToPath(new URL('../../views/admin/products/index.ejs', import.meta.url)),
  });
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

// ─── Price / original price / price colour ───────────────────────────────────

test('pricing migration adds the three columns idempotently, backfills the colour default, and is registered', () => {
  assert.match(pricingMigration, /ADD COLUMN price DECIMAL\(10,2\) NULL/);
  assert.match(pricingMigration, /ADD COLUMN original_price DECIMAL\(10,2\) NULL/);
  assert.match(pricingMigration, /ADD COLUMN price_color VARCHAR\(7\) NOT NULL DEFAULT ''#E53935''/);
  assert.match(pricingMigration, /UPDATE online_products\s*SET price_color = '#E53935'\s*WHERE price_color IS NULL OR price_color = ''/);
  assert.match(
    migrationRunner,
    /'migrate_044_testimonials\.sql',\s*'migrate_045_online_products_pricing\.sql',\s*\/\/ Keep LAST/
  );
});

test('controller create/update persist price, original_price, and price_color from request body', () => {
  // Create: three new columns are part of the INSERT with the parsed values.
  assert.match(controller, /price, original_price, price_color/);
  assert.match(controller, /parsePrice\(req\.body\.price\)/);
  assert.match(controller, /parsePrice\(req\.body\.original_price\)/);
  assert.match(controller, /parsePriceColor\(req\.body\.price_color\)/);

  // Update: the three columns are always assigned (unlike photos, which is
  // only touched when new files arrive), so saving clears a removed price.
  const updateBlock = controller.slice(controller.indexOf('adminUpdateProduct'));
  assert.match(updateBlock, /'price = \?'/);
  assert.match(updateBlock, /'original_price = \?'/);
  assert.match(updateBlock, /'price_color = \?'/);
  assert.match(updateBlock, /parsePrice\(req\.body\.price\)/);
  assert.match(updateBlock, /parsePrice\(req\.body\.original_price\)/);
  assert.match(updateBlock, /parsePriceColor\(req\.body\.price_color\)/);
});

test('price parsing enforces non-negative values and a #RRGGBB colour shape', () => {
  assert.ok(controller.includes('const PRICE_PATTERN = /^#[0-9A-Fa-f]{6}$/;'));
  assert.match(controller, /DEFAULT_PRICE_COLOR = '#E53935'/);
  assert.match(controller, /Number\.isFinite\(value\) && value >= 0 \? value : null/);
  assert.match(controller, /PRICE_PATTERN\.test\(value\) \? value\.toUpperCase\(\) : DEFAULT_PRICE_COLOR/);
});

test('admin form renders the price/colour section with defaults and a live preview', () => {
  const formHtml = ejs.render(formView, { title: 'Edit', product: null, csrfToken: 'token', error: null });
  assert.match(formHtml, /ราคาและการแสดงผล/);
  assert.match(formHtml, /<input type="number" step="0\.01" min="0" class="form-control" name="price"/);
  assert.match(formHtml, /name="original_price"/);
  assert.match(formHtml, /name="price_color"/);
  assert.match(formHtml, /type="color"/);
  assert.match(formHtml, /#E53935/);
  assert.match(formHtml, /text-decoration: line-through/);

  const priced = ejs.render(formView, {
    title: 'Edit',
    product: { id: 2, name: 'Live', product_url: 'https://a.example', price: '117', original_price: '399', price_color: '#0066FF' },
    csrfToken: 'token',
    error: null,
  });
  assert.match(priced, /value="117"/);
  assert.match(priced, /value="399"/);
  assert.match(priced, /value="#0066FF"/);
});

test('admin list table shows selling and struck-through original prices, and hides absent prices', () => {
  const renderList = (products, flash = null) =>
    ejs.render(listTableView, { products, flash }, {
      filename: fileURLToPath(new URL('../../views/admin/products/_list_table.ejs', import.meta.url)),
    });

  const priced = renderList([{
    id: 1, name: 'Priced', product_url: 'https://a.example', photos: null,
    price: 117, original_price: 399, price_color: '#F4511E', status: 'published',
  }]);
  assert.match(priced, /฿117\.00/);
  assert.match(priced, /฿399\.00/);
  assert.match(priced, /#F4511E/);
  assert.match(priced, /text-decoration: line-through/);

  const noPrice = renderList([{ id: 2, name: 'Legacy', product_url: 'https://b.example', photos: null, price: null, original_price: null, status: 'draft' }]);
  assert.doesNotMatch(noPrice, /฿/);
  assert.doesNotMatch(noPrice, /colspan="7"/);

  const emptyList = renderList([]);
  assert.match(emptyList, /colspan="7"/);
});

test('member cards render prices straight from the product row with colour and strikethrough, and hide the line when unpriced', () => {
  const render = (product) => ejs.render(cardView, { t: key => key, products: [product] });

  const unpriced = render({
    id: 1, name: 'Legacy product', product_url: 'https://example.com/product',
    discount_pct: null, badge_label: null, platform: null,
    price: null, original_price: null, price_color: null,
  });
  assert.doesNotMatch(unpriced, /฿/);

  const saleOnly = render({
    id: 2, name: 'Sale only', product_url: 'https://example.com/sale',
    discount_pct: null, badge_label: null, platform: null,
    price: 117, original_price: null, price_color: '#E53935',
  });
  assert.match(saleOnly, /฿117/);
  assert.doesNotMatch(saleOnly, /product-price-was/);
  assert.match(saleOnly, /#E53935/);

  const both = render({
    id: 3, name: 'Both prices', product_url: 'https://example.com/both',
    discount_pct: null, badge_label: null, platform: null,
    price: 117, original_price: 399, price_color: '#0066FF',
  });
  assert.match(both, /฿117/);
  assert.match(both, /฿399/);
  assert.match(both, /#0066FF/);
  assert.match(both, /class="product-price-was"/);

  // Decimal handling: whole numbers stay clean, decimals keep two places —
  // prices must never render as JS float soup on the card.
  const decimal = render({
    id: 4, name: 'Decimal', product_url: 'https://example.com/decimal',
    discount_pct: null, badge_label: null, platform: null,
    price: '67.50', original_price: null, price_color: null,
  });
  assert.match(decimal, /฿67\.50/);
  assert.doesNotMatch(decimal, /67\.5\b/);
});
