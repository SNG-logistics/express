const MANAGEMENT_ROLES = new Set(['admin', 'manager']);

export function expectedWarehouseRole(direction, phase) {
  if (!['TH_TO_LA', 'LA_TO_TH'].includes(direction)) return null;
  if (phase === 'origin') {
    return direction === 'TH_TO_LA' ? 'warehouse_th' : 'warehouse_la';
  }
  if (phase === 'destination') {
    return direction === 'TH_TO_LA' ? 'warehouse_la' : 'warehouse_th';
  }
  return null;
}

export function canManageBranchResource({ role, sessionBranchId, targetBranchId }) {
  if (MANAGEMENT_ROLES.has(role)) return true;
  if (role !== 'branch_operator') return false;
  if (!sessionBranchId || !targetBranchId) return false;
  return String(sessionBranchId) === String(targetBranchId);
}

export function canAutoScanTarget({ role, targetStatus, order, sessionBranchId }) {
  if (!order || !targetStatus) return false;

  if (targetStatus === 'RECEIVED_WH_TH') {
    return expectedWarehouseRole(order.direction, 'origin') === 'warehouse_th'
      && (MANAGEMENT_ROLES.has(role) || role === 'warehouse_th');
  }
  if (targetStatus === 'RECEIVED_WH_LA') {
    return expectedWarehouseRole(order.direction, 'origin') === 'warehouse_la'
      && (MANAGEMENT_ROLES.has(role) || role === 'warehouse_la');
  }
  if (targetStatus === 'AT_DEST_WH') {
    return MANAGEMENT_ROLES.has(role)
      || role === expectedWarehouseRole(order.direction, 'destination');
  }
  if (targetStatus === 'ON_TRUCK' || targetStatus === 'OUT_FOR_DELIVERY') {
    return MANAGEMENT_ROLES.has(role) || role === 'dispatcher' || role === 'driver_support';
  }
  if (targetStatus === 'BRANCH_RECEIVED') {
    if (MANAGEMENT_ROLES.has(role)) return true;
    return role === 'branch_operator'
      && canManageBranchResource({
        role,
        sessionBranchId,
        targetBranchId: order.dest_branch_id,
      });
  }
  return false;
}

export function canUnloadAtDestination({ role, orderDirection, tripDirection }) {
  if (!orderDirection || orderDirection !== tripDirection) return false;
  if (MANAGEMENT_ROLES.has(role) || role === 'dispatcher') return true;
  return role === expectedWarehouseRole(orderDirection, 'destination');
}
