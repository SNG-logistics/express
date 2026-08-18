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
  assert.match(memberController, /const CUSTOMER_HOME = '\/home\?lang=lo'/);
  assert.match(memberController, /req\.session\.returnTo \|\| CUSTOMER_HOME/);
  assert.match(navbar, /href="\/home\?lang=<%= lang %>"/);
});

test('bare subdomain root forces every visitor into the member area, not the public home page', () => {
  assert.match(appSource, /import \{ memberRoot \} from '\.\/controllers\/memberController\.js'/);
  // Calls memberRoot directly instead of res.redirect('/member?lang=lo') —
  // the isMemberSubdomain res.redirect override strips any '/member'-prefixed
  // target down to what follows it, and '/member' alone has nothing after it
  // but the query string, which would strip to a bare '?lang=lo' and
  // redirect-loop back to '/'.
  assert.match(appSource, /isMemberSubdomain\) \{[\s\S]{0,1200}return memberRoot\(req, res\)/);
  assert.doesNotMatch(appSource, /isMemberSubdomain\) return res\.redirect\('\/member/);
  // memberRoot itself still branches: logged-in customers land on CUSTOMER_HOME,
  // logged-out ones get sent to /member/login — this route just hands off to it.
  assert.match(memberController, /req\.session\?\.customer\) return res\.redirect\(CUSTOMER_HOME\)/);
  assert.match(memberController, /return res\.redirect\('\/member\/login'\)/);
});
