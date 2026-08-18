import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeliveryZone } from '../../src/controllers/branchesController.js';

/** A branch on the launch promotion: Zone A free up to 5km, then paid bands. */
const branch = {
  zone_a_km: 5, zone_b_km: 10, zone_c_km: 15,
  fee_zone_a: 0, fee_zone_b: 50000, fee_zone_c: 75000,
};

test('a measured distance lands in the band it falls inside', () => {
  assert.deepEqual(resolveDeliveryZone(0.5, branch), { zone: 'A', fee: 0, measured: true });
  assert.deepEqual(resolveDeliveryZone(7, branch), { zone: 'B', fee: 50000, measured: true });
  assert.deepEqual(resolveDeliveryZone(12, branch), { zone: 'C', fee: 75000, measured: true });
});

test('band edges belong to the cheaper band', () => {
  // "≤5 km ships free" must include a delivery at exactly 5 km.
  assert.equal(resolveDeliveryZone(5, branch).zone, 'A');
  assert.equal(resolveDeliveryZone(10, branch).zone, 'B');
  assert.equal(resolveDeliveryZone(15, branch).zone, 'C');
});

test('beyond the branch radius stays X so a human quotes it', () => {
  const far = resolveDeliveryZone(40, branch);
  assert.equal(far.zone, 'X');
  assert.equal(far.measured, true);
});

test('an unmeasurable distance falls back to the free launch zone, not X', () => {
  // A receiver who has never sent a pin and never had a parcel delivered. The
  // old behaviour was zone 'X' at zero — a broken-looking badge that priced the
  // delivery at nothing anyway.
  for (const unknown of [null, undefined, NaN, '']) {
    const result = resolveDeliveryZone(unknown, branch);
    assert.equal(result.zone, 'A', String(unknown));
    assert.equal(result.fee, 0, String(unknown));
    assert.equal(result.measured, false, String(unknown));
  }
});

test('a known-distant receiver is never handed the promotion just because it is cheap', () => {
  // The fallback exists for unknown distances only. Once measured at 40km, the
  // parcel is out of area even though Zone A costs nothing.
  assert.notEqual(resolveDeliveryZone(40, branch).zone, 'A');
});

test('the fallback quotes whatever Zone A currently costs, not a hardcoded zero', () => {
  // The promotion ends by editing the branch, so the fallback has to follow it.
  const paidZoneA = { ...branch, fee_zone_a: 25000 };
  assert.deepEqual(resolveDeliveryZone(null, paidZoneA), { zone: 'A', fee: 25000, measured: false });
});

test('fees stored as decimal strings by the driver are returned as numbers', () => {
  // mysql2 hands DECIMAL columns back as strings; a string fee would corrupt
  // the hub/branch/rider split arithmetic downstream.
  const stringy = {
    zone_a_km: '5.00', zone_b_km: '10.00', zone_c_km: '15.00',
    fee_zone_a: '0.00', fee_zone_b: '50000.00', fee_zone_c: '75000.00',
  };
  const result = resolveDeliveryZone(7, stringy);
  assert.equal(result.zone, 'B');
  assert.strictEqual(result.fee, 50000);
});
