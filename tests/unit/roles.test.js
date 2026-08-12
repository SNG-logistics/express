import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRM_ROLES,
  OPERATIONAL_ROLES,
  ROLES_ADMIN_ONLY,
  ROLES_COD_REMIT,
  ROLES_CUSTOMER_SERVICE,
  ROLES_CUSTOMS,
  ROLES_FINANCE,
  ROLES_FINANCE_VIEW,
  ROLES_ORDER_WRITE,
  ROLES_RIDER,
  ROLES_SCANNER,
  ROLES_CRM_ADMIN,
  ROLES_CRM_SUPERVISOR,
  ROLES_CRM_AGENT,
  normalizeRole,
  requireRole,
} from '../../src/middleware/auth.js';

function authorize(role, ...allowed) {
  let nextCalled = false;
  const req = { session: { user: { role, username: role } }, originalUrl: '/test' };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    render() { return this; },
    redirect() { this.statusCode = 302; return this; },
  };
  requireRole(...allowed)(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode: res.statusCode };
}

test('every operational role has an executable primary capability', () => {
  const primary = {
    owner: ROLES_ADMIN_ONLY,        // owner is a wildcard — passes every guard
    admin: ROLES_ADMIN_ONLY,
    manager: ROLES_FINANCE,
    accounting: ROLES_FINANCE_VIEW, // read-only financial reporting
    staff: ROLES_ORDER_WRITE,
    dispatcher: ROLES_SCANNER,
    finance: ROLES_COD_REMIT,
    customs: ROLES_CUSTOMS,
    warehouse_th: ROLES_SCANNER,
    warehouse_la: ROLES_SCANNER,
    branch_operator: ROLES_SCANNER,
    customer_service: ROLES_CUSTOMER_SERVICE,
    driver_support: ROLES_SCANNER,
    rider: ROLES_RIDER,
  };
  assert.deepEqual(Object.keys(primary).sort(), [...OPERATIONAL_ROLES].sort());
  for (const role of OPERATIONAL_ROLES) {
    assert.equal(authorize(role, primary[role]).nextCalled, true, role);
  }
});

test('owner is a wildcard superset and accounting is strictly read-only', () => {
  // owner passes guards for groups it is NOT listed in
  assert.equal(authorize('owner', ROLES_RIDER).nextCalled, true);
  assert.equal(authorize('owner', ROLES_COD_REMIT).nextCalled, true);
  assert.equal(authorize('owner', ROLES_CUSTOMS).nextCalled, true);
  // accounting can view financials but never perform write/finance actions
  assert.equal(authorize('accounting', ROLES_FINANCE_VIEW).nextCalled, true);
  assert.equal(authorize('accounting', ROLES_COD_REMIT).statusCode, 403);
  assert.equal(authorize('accounting', ROLES_ORDER_WRITE).statusCode, 403);
  assert.equal(authorize('accounting', ROLES_ADMIN_ONLY).statusCode, 403);
});

test('CRM roles are recognized by their route groups and sensitive actions stay denied', () => {
  const primary = {
    crm_admin: ROLES_CRM_ADMIN,
    crm_supervisor: ROLES_CRM_SUPERVISOR,
    crm_agent: ROLES_CRM_AGENT,
    sales_agent: ROLES_CRM_AGENT,
    logistics_support: ROLES_CRM_AGENT,
    finance_support: ROLES_CRM_AGENT,
  };
  assert.deepEqual(Object.keys(primary).sort(), [...CRM_ROLES].sort());
  for (const role of CRM_ROLES) {
    assert.equal(authorize(role, primary[role]).nextCalled, true, role);
  }
  assert.equal(authorize('staff', ROLES_ADMIN_ONLY).statusCode, 403);
  assert.equal(authorize('rider', ROLES_FINANCE).statusCode, 403);
  assert.equal(authorize('manager', 'admin', 'manager').nextCalled, true);
});

test('legacy warehouse role names normalize at authorization boundary', () => {
  assert.equal(normalizeRole('thai_warehouse'), 'warehouse_th');
  assert.equal(normalizeRole('lao_warehouse'), 'warehouse_la');
  assert.equal(authorize('thai_warehouse', ROLES_SCANNER).nextCalled, true);
});
