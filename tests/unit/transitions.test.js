import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionOrder,
  canTransitionTrip,
  resolveStatus,
} from '../../src/constants/transitions.js';

test('canonical transport workflow cannot skip operational checkpoints', () => {
  const allowed = [
    ['NEW', 'RECEIVED_WH_TH'],
    ['RECEIVED_WH_TH', 'ON_TRUCK'],
    ['ON_TRUCK', 'CROSSING_BORDER'],
    ['CROSSING_BORDER', 'ARRIVED_BORDER_WH'],
    ['ARRIVED_BORDER_WH', 'AT_DEST_WH'],
    ['AT_DEST_WH', 'BRANCH_TRANSFER'],
    ['BRANCH_TRANSFER', 'BRANCH_RECEIVED'],
    ['BRANCH_RECEIVED', 'RIDER_ASSIGNED'],
    ['RIDER_ASSIGNED', 'RIDER_ACCEPTED'],
    ['RIDER_ACCEPTED', 'OUT_FOR_DELIVERY'],
    ['OUT_FOR_DELIVERY', 'DELIVERED'],
    ['DELIVERED', 'COD_COLLECTED'],
    ['COD_COLLECTED', 'COD_REMITTED'],
    ['COD_REMITTED', 'CLOSED'],
  ];
  for (const [from, to] of allowed) assert.equal(canTransitionOrder(from, to), true, `${from} -> ${to}`);

  assert.equal(canTransitionOrder('NEW', 'DELIVERED'), false);
  assert.equal(canTransitionOrder('RIDER_ASSIGNED', 'DELIVERED'), false);
  // AT_DEST_WH -> DELIVERED is a legitimate completion at the office
  // (customer self-pickup OR forwarded to a 3rd-party courier), not a skip.
  assert.equal(canTransitionOrder('AT_DEST_WH', 'DELIVERED'), true);
  assert.equal(canTransitionOrder('AT_DEST_WH', 'BRANCH_TRANSFER'), true);
  assert.equal(canTransitionOrder('AT_DEST_WH', 'OUT_FOR_DELIVERY'), true);
});

test('legacy statuses resolve to canonical values', () => {
  assert.equal(resolveStatus('ON_TRUCK_BORDER'), 'ON_TRUCK');
  assert.equal(resolveStatus('ASSIGNED_TO_RIDER'), 'RIDER_ASSIGNED');
  assert.equal(resolveStatus('ACCEPTED_BY_RIDER'), 'RIDER_ACCEPTED');
  assert.equal(canTransitionOrder('ON_TRUCK_BORDER', 'CROSSING_BORDER'), true);
  assert.equal(canTransitionOrder('READY_TO_LOAD', 'ON_TRUCK'), true);
});

test('trip workflow is sequential', () => {
  assert.equal(canTransitionTrip('PLANNED', 'LOADING'), true);
  assert.equal(canTransitionTrip('PLANNED', 'CANCELLED'), true);
  assert.equal(canTransitionTrip('LOADING', 'CANCELLED'), true);
  assert.equal(canTransitionTrip('LOADING', 'DEPARTED'), true);
  assert.equal(canTransitionTrip('DEPARTED', 'COMPLETED'), false);
  assert.equal(canTransitionTrip('UNLOADING', 'COMPLETED'), true);
});
