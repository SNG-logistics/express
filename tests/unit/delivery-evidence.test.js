import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const branchController = await readFile(
  new URL('../../src/controllers/branchesController.js', import.meta.url),
  'utf8'
);
const orderController = await readFile(
  new URL('../../src/controllers/ordersController.js', import.meta.url),
  'utf8'
);
const riderController = await readFile(
  new URL('../../src/controllers/riderController.js', import.meta.url),
  'utf8'
);
const branchView = await readFile(
  new URL('../../views/branches/dashboard.ejs', import.meta.url),
  'utf8'
);

test('every delivery path stores evidence under the configured orders upload directory', () => {
  for (const source of [branchController, orderController, riderController]) {
    assert.doesNotMatch(source, /['"]\/uploads\/(?:pod\/)?['"]\s*\+/);
  }
  assert.match(branchController, /`\/uploads\/orders\/\$\{req\.file\.filename\}`/);
  assert.match(orderController, /'\/uploads\/orders\/' \+ req\.file\.filename/);
  assert.match(riderController, /'\/uploads\/orders\/' \+ req\.files\[0\]\.filename/);
});

test('branch completion requires recipient, POD and exact COD confirmation', () => {
  assert.match(branchController, /!recipientName \|\| recipientName\.length > 120 \|\| !proofPath/);
  assert.match(branchController, /Math\.abs\(collectedCod - expectedCod\) > 0\.01/);
  assert.match(branchController, /deliveryUpdate\.affectedRows !== 1/);
  assert.match(branchView, /name="recipient_name"[^>]*required/);
  assert.match(branchView, /name="proof_image"[^>]*required/);
  assert.match(branchView, /name="cod_collected_amount"/);
});
