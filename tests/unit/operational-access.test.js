import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAutoScanTarget,
  canManageBranchResource,
  canUnloadAtDestination,
  expectedWarehouseRole,
} from '../../src/services/operationalAccessService.js';

test('warehouse roles are scoped to the origin and destination for each direction', () => {
  assert.equal(expectedWarehouseRole('TH_TO_LA', 'origin'), 'warehouse_th');
  assert.equal(expectedWarehouseRole('TH_TO_LA', 'destination'), 'warehouse_la');
  assert.equal(expectedWarehouseRole('LA_TO_TH', 'origin'), 'warehouse_la');
  assert.equal(expectedWarehouseRole('LA_TO_TH', 'destination'), 'warehouse_th');

  assert.equal(canAutoScanTarget({
    role: 'warehouse_la', targetStatus: 'AT_DEST_WH', order: { direction: 'TH_TO_LA' },
  }), true);
  assert.equal(canAutoScanTarget({
    role: 'warehouse_th', targetStatus: 'AT_DEST_WH', order: { direction: 'TH_TO_LA' },
  }), false);
  // Any Lao point can receive incoming goods — main hub (warehouse_la) or a sub-branch
  assert.equal(canAutoScanTarget({
    role: 'branch_operator', targetStatus: 'AT_DEST_WH', order: { direction: 'TH_TO_LA' },
  }), true);
  assert.equal(canAutoScanTarget({
    role: 'warehouse_th', targetStatus: 'RECEIVED_WH_TH', order: { direction: 'LA_TO_TH' },
  }), false);
  assert.equal(canAutoScanTarget({
    role: 'admin', targetStatus: 'RECEIVED_WH_TH', order: { direction: 'LA_TO_TH' },
  }), false);
});

test('origin warehouse can scan parcels onto the truck (ON_TRUCK), delivery stays dispatch-only', () => {
  // Origin warehouse loads its own outbound truck
  assert.equal(canAutoScanTarget({
    role: 'warehouse_th', targetStatus: 'ON_TRUCK', order: { direction: 'TH_TO_LA' },
  }), true);
  assert.equal(canAutoScanTarget({
    role: 'warehouse_la', targetStatus: 'ON_TRUCK', order: { direction: 'LA_TO_TH' },
  }), true);
  // A warehouse cannot load a truck for the opposite (non-origin) direction
  assert.equal(canAutoScanTarget({
    role: 'warehouse_th', targetStatus: 'ON_TRUCK', order: { direction: 'LA_TO_TH' },
  }), false);
  // Dispatch/driver still allowed
  assert.equal(canAutoScanTarget({
    role: 'dispatcher', targetStatus: 'ON_TRUCK', order: { direction: 'TH_TO_LA' },
  }), true);
  // OUT_FOR_DELIVERY remains dispatch/driver only — warehouse must not do last-mile
  assert.equal(canAutoScanTarget({
    role: 'warehouse_th', targetStatus: 'OUT_FOR_DELIVERY', order: { direction: 'TH_TO_LA' },
  }), false);
});

test('branch operators can scan and manage only their own branch', () => {
  const ownOrder = { direction: 'TH_TO_LA', dest_branch_id: 7 };
  assert.equal(canAutoScanTarget({
    role: 'branch_operator', targetStatus: 'BRANCH_RECEIVED', order: ownOrder, sessionBranchId: 7,
  }), true);
  assert.equal(canAutoScanTarget({
    role: 'branch_operator', targetStatus: 'BRANCH_RECEIVED', order: ownOrder, sessionBranchId: 8,
  }), false);
  assert.equal(canAutoScanTarget({
    role: 'branch_operator', targetStatus: 'BRANCH_RECEIVED', order: ownOrder, sessionBranchId: null,
  }), false);
  assert.equal(canManageBranchResource({ role: 'branch_operator', sessionBranchId: 7, targetBranchId: 8 }), false);
  assert.equal(canManageBranchResource({ role: 'manager', sessionBranchId: null, targetBranchId: 8 }), true);
});

test('unload is restricted to the destination warehouse and matching trip direction', () => {
  assert.equal(canUnloadAtDestination({
    role: 'warehouse_la', orderDirection: 'TH_TO_LA', tripDirection: 'TH_TO_LA',
  }), true);
  assert.equal(canUnloadAtDestination({
    role: 'warehouse_th', orderDirection: 'TH_TO_LA', tripDirection: 'TH_TO_LA',
  }), false);
  assert.equal(canUnloadAtDestination({
    role: 'dispatcher', orderDirection: 'TH_TO_LA', tripDirection: 'LA_TO_TH',
  }), false);
});
