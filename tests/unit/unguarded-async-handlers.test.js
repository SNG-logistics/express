import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

const BRANCHES = readFileSync(new URL('../../src/controllers/branchesController.js', import.meta.url), 'utf8');
const TRIPS    = readFileSync(new URL('../../src/controllers/tripsController.js', import.meta.url), 'utf8');

// Same bug class as assignRider (fixed earlier): an unguarded async route
// handler that calls something able to throw a real WorkflowError on a
// realistic, reachable business path. With no async-error middleware in
// this Express 4 app, an uncaught rejection there is not a 500 — it's a
// hung request, forever, with nothing shown to the user.

test('updateRiderStatus is wrapped in try/catch around its throwing transaction', () => {
  const fn = BRANCHES.slice(BRANCHES.indexOf('export async function updateRiderStatus'));
  const nextExportAt = fn.indexOf('\nexport async function', 1);
  const body = fn.slice(0, nextExportAt > -1 ? nextExportAt : undefined);
  const tryAt   = body.indexOf('try {');
  const throwAt = body.indexOf("throw new WorkflowError('Rider not found in this branch'");
  const catchAt = body.indexOf('} catch (e) {');
  assert.ok(tryAt > -1 && throwAt > -1 && catchAt > -1, 'missing try/throw/catch');
  assert.ok(tryAt < throwAt && throwAt < catchAt, 'the throwing call must sit inside the try/catch');
});

test('detachOrder is wrapped in try/catch around its throwing transition', () => {
  const fn = TRIPS.slice(TRIPS.indexOf('export async function detachOrder'));
  const nextExportAt = fn.indexOf('\n// ─── UPDATE STATUS');
  const body = fn.slice(0, nextExportAt > -1 ? nextExportAt : undefined);
  const tryAt = body.indexOf('try {');
  // force:true does not stop transitionOrder from throwing STALE_ORDER when
  // the row changed between the lock and the update — this is the realistic
  // trigger, not a theoretical one (concurrent scanner/rider action on the
  // same order while a dispatcher is mid-detach).
  const callAt  = body.indexOf('await transitionOrder({');
  const catchAt = body.indexOf('} catch (err) {');
  assert.ok(tryAt > -1 && callAt > -1 && catchAt > -1, 'missing try/transitionOrder/catch');
  assert.ok(tryAt < callAt && callAt < catchAt, 'the throwing call must sit inside the try/catch');
});
