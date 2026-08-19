import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';

const [layoutSrc, appSrc] = await Promise.all([
  readFile(new URL('../../views/customer/layout.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../src/app.js', import.meta.url), 'utf8'),
]);

const layoutPath = fileURLToPath(new URL('../../views/customer/layout.ejs', import.meta.url));

// layout.ejs includes navbar.ejs, so the render needs navbar's own locals too.
const render = (locals) => ejs.render(layoutSrc, {
  lang: 'th', theme: 'dark', title: 'Test', flash: null, body: '<p>content</p>', assetVersion: 'test',
  t: (key) => key, otherTheme: 'light', otherLang: 'lo', otherFlag: '🇱🇦', otherLabel: 'ລາວ',
  portalCurrentUser: null, currentPath: '/home',
  ...locals,
}, {
  filename: layoutPath,
});

test('res.locals.popup is computed once globally, not per-controller', () => {
  assert.match(appSrc, /res\.locals\.popup = null/);
  assert.match(appSrc, /isMemberSubdomain/);
  assert.match(appSrc, /popup_image_path.*popup_link_url|popup_link_url.*popup_image_path/s);
});

test('popup renders with image and link, dismissible, when configured', () => {
  const html = render({ popup: { image: '/uploads/popup/test.png', link: 'https://example.com' } });
  assert.match(html, /class="portal-popup"/);
  assert.match(html, /src="\/uploads\/popup\/test\.png"/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener"/);
  assert.match(html, /sessionStorage\.getItem\('sngPopupDismissed'\)/);
  assert.match(html, /sessionStorage\.setItem\('sngPopupDismissed', '1'\)/);
});

test('popup renders as a plain (non-linked) image when no link is configured', () => {
  const html = render({ popup: { image: '/uploads/popup/test.png', link: null } });
  const popupBlock = html.match(/<div class="portal-popup"[\s\S]*?<\/div>/)[0];
  assert.match(popupBlock, /src="\/uploads\/popup\/test\.png"/);
  assert.doesNotMatch(popupBlock, /<a href=/);
});

test('popup renders nothing when unset', () => {
  const htmlNull = render({ popup: null });
  assert.doesNotMatch(htmlNull, /class="portal-popup"/);

  const htmlNoImage = render({ popup: { image: null, link: null } });
  assert.doesNotMatch(htmlNoImage, /class="portal-popup"/);
});
