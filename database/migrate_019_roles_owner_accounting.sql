-- SNG Logistics migration 019: add 'owner' (system owner, superset of admin)
-- and 'accounting' (read-only financial / investor reporting) roles.
-- Keeps every existing operational and CRM role. Idempotent (re-running the
-- MODIFY is safe — it just re-declares the same enum set).
ALTER TABLE users MODIFY COLUMN role ENUM(
  'owner',
  'admin','staff','manager',
  'thai_warehouse','lao_warehouse',
  'dispatcher','customer_service','finance','accounting','branch_operator','rider',
  'warehouse_th','warehouse_la','customs','driver_support',
  'crm_admin','crm_supervisor','crm_agent',
  'sales_agent','logistics_support','finance_support'
) NOT NULL DEFAULT 'staff';
