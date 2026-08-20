import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import ejs from 'ejs';

const VIEW = readFileSync(new URL('../../views/customer/member/online.ejs', import.meta.url), 'utf8');
const CSS  = readFileSync(new URL('../../public/css/portal.css', import.meta.url), 'utf8');

const product = {
  id: 1, name: 'SUMSUNG ตู้เย็น 2 ประตู Digital Inverter 14.7 คิว',
  product_url: 'https://example.com/p', photos: JSON.stringify(['/uploads/products/a.jpg']),
  price: 6390, original_price: 10690, price_color: '#E53935',
  discount_pct: 40, badge_label: null, platform: 'lazada',
};
const html = ejs.render(VIEW, { t: key => key, products: [product] });

/** The declarations inside one rule, so a size can be read back. */
function rule(selector, css = CSS) {
  const at = css.indexOf(selector + ' {');
  if (at === -1) return null;
  return css.slice(at, css.indexOf('}', at));
}

/**
 * A rule as redefined inside a media query.
 *
 * The stylesheet reuses breakpoints — there are several `@media (min-width:
 * 640px)` blocks — so this walks every block with that query and returns the
 * one that actually defines the selector, matching braces rather than guessing
 * where the block ends.
 */
function ruleInMedia(query, selector) {
  for (let at = CSS.indexOf(query); at !== -1; at = CSS.indexOf(query, at + 1)) {
    let depth = 0;
    let end = CSS.indexOf('{', at);
    for (let i = end; i < CSS.length; i++) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}' && --depth === 0) { end = i; break; }
    }
    const found = rule(selector, CSS.slice(at, end));
    if (found) return found;
  }
  return null;
}

const sizeOf = (declarations) => {
  const match = /font-size:\s*([\d.]+)rem/.exec(declarations || '');
  return match ? Number(match[1]) : null;
};

test('the card carries no inline font sizes left to override', () => {
  // Inline styles cannot answer a media query, which is why the phone was
  // stuck with sizes drawn for a desktop card.
  assert.ok(!/style="[^"]*font-size/.test(html), 'an inline font-size is back on the card');
});

test('the text block keeps only the per-product price colour inline', () => {
  // The photo area still styles itself inline — the carousel's positions and
  // opacities are animation state, not typography. The text block is the part
  // that has to be sizable from the stylesheet.
  const body = html.slice(html.indexOf('class="product-body"'));
  const inline = body.match(/style="[^"]*"/g) || [];
  for (const style of inline) {
    assert.match(style, /^style="color: #[0-9A-Fa-f]{3,8};"$/,
      `unexpected inline style in the card text: ${style}`);
  }
  assert.equal(inline.length, 1, 'the price colour comes from the product row');
});

test('phone sizes are smaller than the desktop ones they replaced', () => {
  // The old inline values: name 1.05rem, price 1.35rem, was 0.9rem.
  assert.ok(sizeOf(rule('.product-name')) < 1.05, 'title still fills the card');
  assert.ok(sizeOf(rule('.product-price')) < 1.35, 'price still oversized');
  assert.ok(sizeOf(rule('.product-price-was')) < 0.9);
  assert.ok(sizeOf(rule('.product-platform')) < 0.78);
});

test('the title stays readable rather than merely small', () => {
  // Below ~0.7rem Thai and Lao script stops being legible on a phone.
  assert.ok(sizeOf(rule('.product-name')) >= 0.72, 'title shrunk past legibility');
  assert.ok(sizeOf(rule('.product-price')) >= 0.9, 'the price is the thing people look for');
});

test('the price stays larger than the title, so it is still what the eye lands on', () => {
  assert.ok(sizeOf(rule('.product-price')) > sizeOf(rule('.product-name')));
  assert.ok(sizeOf(rule('.product-price')) > sizeOf(rule('.product-price-was')));
});

test('narrow phones step down again, and never up', () => {
  const narrowName = sizeOf(ruleInMedia('@media (max-width: 360px)', '.product-name'));
  assert.ok(narrowName, 'no narrow-phone override');
  assert.ok(narrowName < sizeOf(rule('.product-name')));
});

test('tablets and up get the room back', () => {
  // Shrinking for the phone must not leave a desktop looking sparse.
  const wideName = sizeOf(ruleInMedia('@media (min-width: 640px)', '.product-name'));
  assert.ok(wideName > sizeOf(rule('.product-name')), 'wide screens kept the phone size');
});

test('two lines of title are reserved so prices line up across a row', () => {
  assert.match(rule('.product-name'), /-webkit-line-clamp:\s*2/);
  assert.match(rule('.product-name'), /min-height:\s*2\.8em/);
});

test('a long seller badge is clipped inside the photo', () => {
  // "300+คน รีวิว 5 ดาว" ran off the edge of the card.
  const badge = rule('.product-badge');
  assert.match(badge, /max-width:\s*calc\(100% - /);
  assert.match(badge, /text-overflow:\s*ellipsis/);
  // Clipped on screen, still readable on hover and to a screen reader.
  assert.match(html, /class="product-badge" title="/);
});

test('the grid still renders both prices and the platform', () => {
  assert.ok(html.includes('฿6,390'));
  assert.ok(html.includes('฿10,690'));
  assert.ok(html.includes('Lazada'));
  assert.match(html, /class="product-grid"/);
});
