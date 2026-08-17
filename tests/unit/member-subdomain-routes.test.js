import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [appSource, memberController, publicRoutes, navbar] = await Promise.all([
  readFile(new URL('../../src/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/memberController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/routes/public.js', import.meta.url), 'utf8'),
  readFile(new URL('../../views/customer/navbar.ejs', import.meta.url), 'utf8'),
]);

test('member subdomain rewrites clean quote-request URLs to protected member routes', () => {
  const barePaths = appSource.match(/const MEMBER_BARE_PATHS = \[([\s\S]*?)\];/);
  assert.ok(barePaths, 'MEMBER_BARE_PATHS must be declared');
  assert.match(barePaths[1], /'\/quote-request'/);
  assert.match(barePaths[1], /'\/quote-requests'/);
  assert.match(appSource, /req\.url = '\/member' \+ req\.url/);
});

test('member customer home uses the canonical Lao landing URL', () => {
  const directPaths = appSource.match(/const CUSTOMER_DIRECT_PATHS = \[([\s\S]*?)\];/);
  assert.ok(directPaths, 'CUSTOMER_DIRECT_PATHS must be declared');
  assert.match(directPaths[1], /'\/home'/);
  assert.match(publicRoutes, /router\.get\('\/home', publicController\.home\)/);
  assert.match(appSource, /isMemberSubdomain\) return res\.redirect\('\/home\?lang=lo'\)/);
  assert.match(memberController, /const CUSTOMER_HOME = '\/home\?lang=lo'/);
  assert.match(memberController, /req\.session\.returnTo \|\| CUSTOMER_HOME/);
  assert.match(navbar, /href="\/home\?lang=<%= lang %>"/);
});
