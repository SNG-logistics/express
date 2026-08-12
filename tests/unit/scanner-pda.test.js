import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

const template = await readFile(new URL('../../views/scanner/pda.ejs', import.meta.url), 'utf8');
const controller = await readFile(new URL('../../src/controllers/scannerController.js', import.meta.url), 'utf8');
const routes = await readFile(new URL('../../src/routes/scanner.js', import.meta.url), 'utf8');

test('PDA scanner sends CSRF token with every JSON POST', () => {
  assert.match(template, /meta name="csrf-token" content="<%= csrfToken %>"/);
  assert.match(template, /'X-CSRF-Token': CSRF_TOKEN/);

  const postFetches = [...template.matchAll(/fetch\([^;]+?method:\s*['"]POST['"][^;]+?\}\);/gs)];
  assert.ok(postFetches.length >= 2, 'expected the PDA update and lookup POST requests');
  for (const [request] of postFetches) {
    assert.match(request, /headers:\s*JSON_HEADERS/, 'every PDA POST must include CSRF headers');
  }
});

test('PDA scanner documents iT78 keyboard-wedge compatibility', () => {
  assert.match(template, /iT78 \/ IT68 keyboard-wedge mode/);
});

test('PDA options match the server workflow and never bypass delivery evidence', () => {
  assert.match(template, /option value="BRANCH_RECEIVED"/);
  assert.doesNotMatch(template, /option value="DELIVERED"/);
  assert.doesNotMatch(template, /quickUpdate\([^)]*DELIVERED/);
  assert.match(controller, /WHERE status IN \('PLANNED','LOADING'\)/);
  assert.match(routes, /const AUTO_SCAN = \[\.\.\.WAREHOUSE_SCAN, 'branch_operator', 'driver_support'\]/);
});

test('PDA renders only the scanner actions permitted for each device role', () => {
  const optionsFor = (role) => {
    const html = ejs.render(template, {
      user: { username: `test-${role}`, role, branch_id: role === 'branch_operator' ? 1 : null },
      csrfToken: 'test-token',
      trips: [],
    });
    return [...html.matchAll(/<option value="([A-Z_]+)"/g)].map((match) => match[1]);
  };

  assert.deepEqual(optionsFor('warehouse_th'), ['RECEIVED_WH_TH', 'AT_DEST_WH']);
  assert.deepEqual(optionsFor('warehouse_la'), ['RECEIVED_WH_LA', 'AT_DEST_WH']);
  assert.deepEqual(optionsFor('branch_operator'), ['BRANCH_RECEIVED']);
  assert.deepEqual(optionsFor('driver_support'), ['ON_TRUCK', 'OUT_FOR_DELIVERY']);
  assert.deepEqual(optionsFor('admin'), [
    'RECEIVED_WH_TH', 'RECEIVED_WH_LA', 'AT_DEST_WH',
    'ON_TRUCK', 'OUT_FOR_DELIVERY', 'BRANCH_RECEIVED',
  ]);

  const unlinkedBranchHtml = ejs.render(template, {
    user: { username: 'unlinked-branch', role: 'branch_operator', branch_id: null },
    csrfToken: 'test-token',
    trips: [],
  });
  assert.doesNotMatch(unlinkedBranchHtml, /option value="BRANCH_RECEIVED"/);
});
