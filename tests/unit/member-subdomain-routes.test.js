import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../../src/app.js', import.meta.url), 'utf8');

test('member subdomain rewrites clean quote-request URLs to protected member routes', () => {
  const barePaths = appSource.match(/const MEMBER_BARE_PATHS = \[([\s\S]*?)\];/);
  assert.ok(barePaths, 'MEMBER_BARE_PATHS must be declared');
  assert.match(barePaths[1], /'\/quote-request'/);
  assert.match(barePaths[1], /'\/quote-requests'/);
  assert.match(appSource, /req\.url = '\/member' \+ req\.url/);
});
