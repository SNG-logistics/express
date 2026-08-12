-- SNG Logistics migration 021: authoritative users.role ENUM.
-- This is the SINGLE canonical role list and MUST include every role the app
-- uses, including owner + accounting. It is intentionally re-asserted after the
-- CRM migration too (run_crm_migration.mjs), because migrate_crm_001.sql
-- redeclares this column with an older list that drops owner/accounting.
-- Idempotent: re-running just re-declares the same enum.
ALTER TABLE users MODIFY COLUMN role ENUM(
  'owner',
  'admin','staff','manager',
  'thai_warehouse','lao_warehouse',
  'dispatcher','customer_service','finance','accounting','branch_operator','rider',
  'warehouse_th','warehouse_la','customs','driver_support',
  'crm_admin','crm_supervisor','crm_agent',
  'sales_agent','logistics_support','finance_support'
) NOT NULL DEFAULT 'staff';
