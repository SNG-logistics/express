import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../../src/app.js', import.meta.url), 'utf8');
const branchRoutes = await readFile(new URL('../../src/routes/branches.js', import.meta.url), 'utf8');

test('database migration trigger is a CSRF-protected POST, never a state-changing GET', () => {
  assert.match(appSource, /app\.post\('\/api\/fix-db'/);
  assert.doesNotMatch(appSource, /app\.get\('\/api\/fix-db'/);
});

test('branch rider account administration stays restricted to management roles', () => {
  const riderAdminRoutes = branchRoutes
    .split('\n')
    .filter(line => line.includes('/branches/:id/riders'));
  assert.equal(riderAdminRoutes.length, 2);
  for (const route of riderAdminRoutes) {
    assert.match(route, /requireRole\(\['admin','manager'\]\)/);
    assert.doesNotMatch(route, /branch_operator/);
  }
});
