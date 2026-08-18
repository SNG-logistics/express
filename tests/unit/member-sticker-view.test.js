import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [memberController, memberRoutes] = await Promise.all([
  readFile(new URL('../../src/controllers/memberController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/routes/member.js', import.meta.url), 'utf8'),
]);

test('member sticker route is customer-authenticated and ownership-scoped by phone', () => {
  assert.match(
    memberRoutes,
    /router\.get\('\/member\/orders\/:jobNo\/sticker', requireCustomerLogin, member\.myOrderSticker\)/,
  );
  assert.match(memberController, /export async function myOrderSticker/);
  assert.match(
    memberController,
    /WHERE o\.job_no = \?\s*\r?\n\s*AND \(s\.phone_normalized = \? OR r\.phone_normalized = \? OR s\.phone = \? OR r\.phone = \?\)/,
  );
  assert.match(memberController, /res\.set\('Cache-Control', 'no-store'\)/);
});

test('sticker not-found and not-owned both fall through to the same 404 render (no existence leak)', () => {
  const fn = memberController.slice(
    memberController.indexOf('export async function myOrderSticker'),
    memberController.indexOf('\n/**', memberController.indexOf('export async function myOrderSticker') + 1),
  );
  const notFoundCalls = fn.match(/renderNotFound\(\)/g) || [];
  assert.ok(notFoundCalls.length >= 2, 'expected the same renderNotFound() call reused for both not-found paths');
});

test('an explicit ?lang= query param overrides the sticker\'s default language', () => {
  assert.match(memberController, /req\.query\.lang \? req\.query\.lang === 'la' : defaultIsLa/);
});
