import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import ejs from 'ejs';

const HOME = readFileSync(new URL('../../views/customer/home.ejs', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../public/css/portal.css', import.meta.url), 'utf8');
const ROUTES = readFileSync(new URL('../../src/routes/onlineProducts.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');
const th = JSON.parse(readFileSync(new URL('../../src/i18n/th.json', import.meta.url)));
const lo = JSON.parse(readFileSync(new URL('../../src/i18n/lo.json', import.meta.url)));

const t = key => key.split('.').reduce((o, p) => o?.[p], th) ?? key;

function renderHome(company = {}) {
  return ejs.render(HOME, {
    t, lang: 'th', company,
    portalCurrentUser: null,
    homeMember: null,
  });
}

test('the banner links to the public catalogue, not the member one', () => {
  // The home page is public. Pointing the banner at /member/online would send
  // every non-member who taps it into a login wall — ending the visit that the
  // marketing paid for.
  const html = renderHome({ home_banner_path: '/uploads/banner/b.jpg' });
  assert.match(html, /class="home-banner" href="\/online"/);
  assert.ok(!html.includes('href="/member/online"'), 'banner must not require an account');
});

test('/online is reachable without logging in, and the member path still works', () => {
  assert.match(ROUTES, /router\.get\('\/online', products\.listProducts\)/);
  assert.match(ROUTES, /router\.get\('\/member\/online', requireCustomerLogin/);
  // The customer-host router only lets recognised public paths through.
  assert.match(APP, /CUSTOMER_DIRECT_PATHS = \[[^\]]*'\/online'/);
});

test('no banner uploaded means no empty frame on the home page', () => {
  const html = renderHome({});
  assert.ok(!html.includes('home-banner'), 'a hole in the middle of the page is worse than nothing');
});

test('an emptied banner setting counts as no banner', () => {
  // removeHomeBanner clears the value rather than deleting the row, so the
  // page must treat '' the same as absent.
  assert.ok(!renderHome({ home_banner_path: '' }).includes('home-banner'));
});

test('the frame is 6:9 as specified, and capped so it cannot swallow a desktop page', () => {
  assert.match(CSS, /\.home-banner\s*\{[^}]*aspect-ratio:\s*6\s*\/\s*9/);
  assert.match(CSS, /\.home-banner\s*\{[^}]*max-height:\s*70vh/);
});

test('the call to action stays legible over whatever photo is uploaded', () => {
  // Text laid directly on an unknown image is unreadable half the time; the
  // scrim is what makes this independent of the art.
  assert.match(CSS, /\.home-banner-cta\s*\{[^}]*linear-gradient/);
  const html = renderHome({ home_banner_path: '/uploads/banner/b.jpg' });
  assert.ok(html.includes(th.portal.bannerCta));
});

test('the banner image is described for anyone who cannot see it', () => {
  const html = renderHome({ home_banner_path: '/uploads/banner/b.jpg' });
  assert.match(html, /<img src="\/uploads\/banner\/b\.jpg" alt="[^"]+"/);
});

test('banner wording exists in both languages', () => {
  for (const key of ['bannerAlt', 'bannerCta']) {
    assert.ok(th.portal?.[key], `th.portal.${key} missing`);
    assert.ok(lo.portal?.[key], `lo.portal.${key} missing`);
  }
});
