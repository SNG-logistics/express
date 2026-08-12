-- SNG Logistics migration 015: keep every operational and CRM role available.
ALTER TABLE users MODIFY COLUMN role ENUM(
  'admin','staff','manager',
  'thai_warehouse','lao_warehouse',
  'dispatcher','customer_service','finance','branch_operator','rider',
  'warehouse_th','warehouse_la','customs','driver_support',
  'crm_admin','crm_supervisor','crm_agent',
  'sales_agent','logistics_support','finance_support'
) NOT NULL DEFAULT 'staff';

UPDATE users SET role='warehouse_th' WHERE role='thai_warehouse';
UPDATE users SET role='warehouse_la' WHERE role='lao_warehouse';
