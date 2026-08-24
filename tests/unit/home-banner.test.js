import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import ejs from 'ejs';
import { companyPhone, companyEmail, telHref } from '../../src/utils/companyContact.js';

const HOME = readFileSync(new URL('../../views/customer/home.ejs', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../public/css/portal.css', import.meta.url), 'utf8');
const ROUTES = readFileSync(new URL('../../src/routes/onlineProducts.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');
const SETTINGS_ROUTES = readFileSync(new URL('../../src/routes/settings.js', import.meta.url), 'utf8');
const SETTINGS_CONTROLLER = readFileSync(new URL('../../src/controllers/settingsController.js', import.meta.url), 'utf8');
const PANEL = readFileSync(new URL('../../views/settings/_panel_banner.ejs', import.meta.url), 'utf8');
const th = JSON.parse(readFileSync(new URL('../../src/i18n/th.json', import.meta.url)));
const lo = JSON.parse(readFileSync(new URL('../../src/i18n/lo.json', import.meta.url)));

const t = key => key.split('.').reduce((o, p) => o?.[p], th) ?? key;

function renderHome(company = {}) {
  return ejs.render(HOME, {
    t, lang: 'th', company,
    portalCurrentUser: null,
    homeMember: null,
    // Supplied app-wide by res.locals; see src/utils/companyContact.js.
    companyPhone, companyEmail, telHref,
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

test('the frame is 16:9, so the services below it stay on screen', () => {
  // A portrait banner filled a phone and pushed everything else past the fold.
  assert.match(CSS, /\.home-banner\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
  assert.doesNotMatch(CSS, /\.home-banner\s*\{[^}]*aspect-ratio:\s*6\s*\/\s*9/);
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

// ── Horoscope banner — same admin-managed pattern, second target ──────────

test('the horoscope banner links to the login-gated member page', () => {
  const html = renderHome({ horoscope_banner_path: '/uploads/banner/h.jpg' });
  assert.match(html, /class="home-banner" href="\/member\/horoscope"/);
});

test('no horoscope banner uploaded means no empty frame, independent of the shopping banner', () => {
  assert.ok(!renderHome({}).includes('/member/horoscope'));
  // Uploading only the shopping banner must not accidentally render the
  // horoscope one too (they are two independent settings, not one toggle).
  const shoppingOnly = renderHome({ home_banner_path: '/uploads/banner/b.jpg' });
  assert.ok(!shoppingOnly.includes('/member/horoscope'));
});

test('an emptied horoscope banner setting counts as no banner', () => {
  assert.ok(!renderHome({ horoscope_banner_path: '' }).includes('/member/horoscope'));
});

test('both banners can be uploaded and render together, each with its own target', () => {
  const html = renderHome({
    home_banner_path: '/uploads/banner/b.jpg',
    horoscope_banner_path: '/uploads/banner/h.jpg',
  });
  assert.match(html, /class="home-banner" href="\/online"/);
  assert.match(html, /class="home-banner" href="\/member\/horoscope"/);
  assert.match(html, /<img src="\/uploads\/banner\/b\.jpg"/);
  assert.match(html, /<img src="\/uploads\/banner\/h\.jpg"/);
});

test('horoscope banner wording exists in both languages', () => {
  for (const key of ['horoscopeBannerAlt', 'horoscopeBannerCta']) {
    assert.ok(th.portal?.[key], `th.portal.${key} missing`);
    assert.ok(lo.portal?.[key], `lo.portal.${key} missing`);
  }
});

test('the horoscope banner upload/remove routes reuse the existing bannerUpload middleware and admin/manager role gate', () => {
  assert.match(
    SETTINGS_ROUTES,
    /router\.post\('\/settings\/horoscope-banner', requireLogin, requireRole\(\['admin','manager'\]\), bannerUpload\.single\('banner_file'\), settings\.uploadHoroscopeBanner\)/
  );
  assert.match(
    SETTINGS_ROUTES,
    /router\.post\('\/settings\/horoscope-banner\/remove', requireLogin, requireRole\(\['admin','manager'\]\), settings\.removeHoroscopeBanner\)/
  );
  // No second multer config — reuses the exact same upload used for the home banner.
  assert.equal((SETTINGS_ROUTES.match(/const bannerUpload = multer\(/g) || []).length, 1);
});

test('uploadHoroscopeBanner/removeHoroscopeBanner mirror the home-banner pair: same setting-store pattern, own key', () => {
  assert.match(SETTINGS_CONTROLLER, /export async function uploadHoroscopeBanner\(req, res\) \{/);
  assert.match(SETTINGS_CONTROLLER, /VALUES \('horoscope_banner_path', \?, \?\)/);
  assert.match(SETTINGS_CONTROLLER, /export async function removeHoroscopeBanner\(req, res\) \{/);
  assert.match(SETTINGS_CONTROLLER, /WHERE setting_key = 'horoscope_banner_path'/);
});

test('the admin panel exposes an upload + remove control for the horoscope banner', () => {
  assert.match(PANEL, /action="\/settings\/horoscope-banner\?_csrf=/);
  assert.match(PANEL, /action="\/settings\/horoscope-banner\/remove"/);
  assert.match(PANEL, /company\.horoscope_banner_path/);
});
