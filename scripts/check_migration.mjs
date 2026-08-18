/**
 * scripts/check_migration.mjs
 * ─────────────────────────────────────────────────────────────────
 * ตรวจสอบสถานะ DB Migration ทั้งหมดของ SNG Logistics
 * รัน: node scripts/check_migration.mjs
 * ─────────────────────────────────────────────────────────────────
 */
import pool from '../src/config/db.js';

const OK   = (msg) => console.log(`  ✅  ${msg}`);
const FAIL = (msg) => console.log(`  ❌  ${msg}`);
const WARN = (msg) => console.log(`  ⚠️   ${msg}`);
const INFO = (msg) => console.log(`  ℹ️   ${msg}`);
const HEAD = (msg) => console.log(`\n${'═'.repeat(58)}\n  ${msg}\n${'═'.repeat(58)}`);
const SUB  = (msg) => console.log(`\n  ── ${msg} ──────────────────────────────`);

let totalPass = 0;
let totalFail = 0;

function check(label, condition, failMsg = '') {
  if (condition) { OK(label); totalPass++; }
  else           { FAIL(`${label}${failMsg ? ' → ' + failMsg : ''}`); totalFail++; }
  return condition;
}

async function hasTable(name) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [name]
  );
  return row.c > 0;
}

async function hasColumn(table, col) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, col]
  );
  return row.c > 0;
}

async function getEnumValues(table, col) {
  const [[row]] = await pool.query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, col]
  );
  return row?.COLUMN_TYPE || '';
}

async function hasIndex(table, indexName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, [table, indexName]
  );
  return row.c > 0;
}

async function rowCount(table) {
  const [[row]] = await pool.query(`SELECT COUNT(*) AS c FROM \`${table}\``);
  return row.c;
}

// ─────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     SNG Logistics — DB Migration Verification           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // ── DB Info ─────────────────────────────────────────────────────
  HEAD('ข้อมูล Database');
  const [[dbRow]] = await pool.query('SELECT DATABASE() AS db');
  const [[verRow]] = await pool.query('SELECT VERSION() AS ver');
  INFO(`Database : ${dbRow.db}`);
  INFO(`MySQL    : ${verRow.ver}`);

  // ────────────────────────────────────────────────────────────────
  HEAD('SECTION 1: Core Tables (schema.sql)');
  // ────────────────────────────────────────────────────────────────
  const coreTables = [
    'orders','customers','users','trips','trip_orders',
    'payments','order_status_logs','shipping_rates','cod_settlements'
  ];
  for (const t of coreTables) {
    const exists = await hasTable(t);
    if (exists) {
      const cnt = await rowCount(t);
      OK(`${t.padEnd(25)} (${cnt} rows)`);
      totalPass++;
    } else {
      FAIL(`${t} — ❌ TABLE MISSING → รัน schema.sql`);
      totalFail++;
    }
  }

  // ────────────────────────────────────────────────────────────────
  HEAD('SECTION 2: Branch Hub Tables (migrate_003b.sql)');
  // ────────────────────────────────────────────────────────────────
  const branchTables = [
    ['branches',         'migrate_003b.sql'],
    ['riders',           'migrate_003b.sql'],
    ['branch_deliveries','migrate_003b.sql'],
    ['branch_revenue',   'migrate_003b.sql'],
  ];
  for (const [t, mig] of branchTables) {
    const exists = await hasTable(t);
    if (exists) {
      const cnt = await rowCount(t);
      OK(`${t.padEnd(25)} (${cnt} rows)`);
      totalPass++;
    } else {
      FAIL(`${t.padEnd(25)} → รัน ${mig}`);
      totalFail++;
    }
  }

  SUB('orders — branch columns (migrate_003b.sql)');
  const branchOrderCols = ['dest_branch_id','delivery_zone','last_mile_fee','receiver_lat','receiver_lng'];
  for (const col of branchOrderCols) {
    check(`orders.${col}`, await hasColumn('orders', col), 'รัน migrate_003b.sql');
  }

  SUB('users — branch_id FK (migrate_003b.sql)');
  check('users.branch_id', await hasColumn('users','branch_id'), 'รัน migrate_003b.sql');

  // ────────────────────────────────────────────────────────────────
  HEAD('SECTION 3: Operational Workflow Tables (migrate_004.sql)');
  // ────────────────────────────────────────────────────────────────
  const opTables = [
    ['order_flags',          'migrate_004.sql'],
    ['la_carriers',          'migrate_004.sql'],
    ['dispatch_assignments', 'migrate_004.sql'],
  ];
  for (const [t, mig] of opTables) {
    const exists = await hasTable(t);
    if (exists) {
      const cnt = await rowCount(t);
      OK(`${t.padEnd(25)} (${cnt} rows)`);
      totalPass++;
    } else {
      FAIL(`${t.padEnd(25)} → รัน ${mig}`);
      totalFail++;
    }
  }

  SUB('orders — screening + delivery columns (migrate_004.sql)');
  const screeningCols = [
    'source_type','source_tracking_no','item_count','weight_kg',
    'dim_l_cm','dim_w_cm','dim_h_cm','chargeable_kg',
    'is_fragile','is_high_value',
    'screening_status','screening_note','screened_by','screened_at',
    'sticker_printed_at','intake_photos','pod_photo_url',
    'recipient_name','delivered_at','delivered_by',
    'fail_reason','fail_count','next_attempt_date'
  ];
  for (const col of screeningCols) {
    check(`orders.${col}`, await hasColumn('orders', col), 'รัน migrate_004.sql');
  }

  SUB('customers — extra columns (migrate_004.sql)');
  const custCols = ['district','preferred_carrier','notes'];
  for (const col of custCols) {
    check(`customers.${col}`, await hasColumn('customers', col), 'รัน migrate_004.sql');
  }

  SUB('trips — extra columns (migrate_004.sql)');
  const tripCols004 = [
    'direction','vehicle_plate','vehicle_type','driver_phone',
    'border_checkpoint','departed_th_at','arrived_border_at',
    'crossed_border_at','arrived_la_at','total_weight_kg','total_items',
    'manifest_pdf_url','notes'
  ];
  for (const col of tripCols004) {
    check(`trips.${col}`, await hasColumn('trips', col), 'รัน migrate_004.sql');
  }

  SUB('la_carriers — seed data');
  if (await hasTable('la_carriers')) {
    const cnt = await rowCount('la_carriers');
    check(`la_carriers มีข้อมูล Seed (≥4 rows)`, cnt >= 4, `พบ ${cnt} rows — รัน migrate_004.sql อีกครั้ง`);
  }

  // ────────────────────────────────────────────────────────────────
  HEAD('SECTION 4: Missing Columns (migrate_005.sql)');
  // ────────────────────────────────────────────────────────────────
  check('orders.item_description', await hasColumn('orders','item_description'), 'รัน migrate_005_missing_cols.sql');
  check('orders.created_by',       await hasColumn('orders','created_by'),       'รัน migrate_005_missing_cols.sql');

  // ────────────────────────────────────────────────────────────────
  HEAD('SECTION 5: Trips Schema v2 (migrate_006.sql)');
  // ────────────────────────────────────────────────────────────────
  check('trips.direction',   await hasColumn('trips','direction'),   'รัน migrate_006_trips_schema.sql');
  check('trips.max_weight',  await hasColumn('trips','max_weight'),  'รัน migrate_006_trips_schema.sql');

  SUB('trips.status ENUM — ต้องมี v2 values');
  const tripsStatusEnum = await getEnumValues('trips','status');
  const requiredTripStatuses = ['LOADING','DEPARTED','AT_BORDER','CROSSED','UNLOADING','COMPLETED','CANCELLED'];
  for (const s of requiredTripStatuses) {
    check(`trips.status includes '${s}'`, tripsStatusEnum.includes(s), 'รัน migrate_006_trips_schema.sql');
  }

  // ────────────────────────────────────────────────────────────────
  HEAD('SECTION 6: Security Hardening (migrate_017_security_compat.sql)');
  // ────────────────────────────────────────────────────────────────
  check('users.deactivated_at', await hasColumn('users','deactivated_at'), 'รัน migrate_017_security_compat.sql');
  // branch_id ครอบคลุมแล้วใน section 2

  SUB('users.role ENUM — ต้องมี roles ใหม่ทั้งหมด');
  const usersRoleEnum = await getEnumValues('users','role');
  const requiredRoles = [
    'admin','manager','finance','dispatcher',
    'warehouse_th','warehouse_la','customs',
    'branch_operator','driver_support','customer_service','staff','rider',
    'crm_admin','crm_supervisor','crm_agent','sales_agent','logistics_support','finance_support'
  ];
  for (const r of requiredRoles) {
    check(`users.role includes '${r}'`, usersRoleEnum.includes(r), 'รัน migrate_003b.sql + migrate_017_security_compat.sql');
  }

  SUB('users.status ENUM — inactive (ไม่ใช่ deleted)');
  const usersStatusEnum = await getEnumValues('users','status');
  check("users.status has 'inactive'", usersStatusEnum.includes('inactive'), 'รัน migrate_017_security_compat.sql');
  if (usersStatusEnum.includes('disabled') && !usersStatusEnum.includes('inactive')) {
    WARN("users.status ยังใช้ 'disabled' — controller อาจใช้ 'inactive' แทน — ตรวจ usersController.js");
  }

  // ────────────────────────────────────────────────────────────────
  HEAD('SECTION 7: App-Level Tables (initDb ใน app.js)');
  // ────────────────────────────────────────────────────────────────
  // Tables ที่ app.js สร้างเอง
  const appTables = [
    ['shipping_rates',     'app.js initDb()'],
    ['cod_settlements',    'app.js initDb()'],
    ['exchange_rates',     'app.js initDb()'],
    ['partner_quotations', 'app.js initDb()'],
    ['sessions',           'express-mysql-session auto-create'],
  ];
  for (const [t, note] of appTables) {
    const exists = await hasTable(t);
    if (exists) {
      const cnt = await rowCount(t);
      OK(`${t.padEnd(25)} (${cnt} rows) — ${note}`);
      totalPass++;
    } else {
      FAIL(`${t.padEnd(25)} → ${note} — รัน/restart app`);
      totalFail++;
    }
  }

  SUB('cod_settlements — UNIQUE KEY uq_cod_order');
  check('cod_settlements has uq_cod_order', await hasIndex('cod_settlements','uq_cod_order'), 'app.js initDb() ไม่สามารถสร้างได้ (duplicate data?)');

  SUB('shipping_rates — seed data');
  if (await hasTable('shipping_rates')) {
    const cnt = await rowCount('shipping_rates');
    check(`shipping_rates มีข้อมูล (≥1)`, cnt >= 1, `พบ ${cnt} rows — ต้องเพิ่มอัตราค่าขนส่ง`);
  }

  // ────────────────────────────────────────────────────────────────
  HEAD('SECTION 8: Indexes สำคัญ');
  // ────────────────────────────────────────────────────────────────
  const indexes = [
    ['orders',    'idx_orders_source_type',      'migrate_004.sql'],
    ['orders',    'idx_orders_screening_status',  'migrate_004.sql'],
    ['customers', 'idx_customers_phone',          'migrate_004.sql'],
    ['users',     'idx_users_branch_id',          'migrate_017_security_compat.sql'],
  ];
  for (const [t, idx, mig] of indexes) {
    check(`${t}.${idx}`, await hasIndex(t, idx), `รัน ${mig}`);
  }

  HEAD('SECTION 9: Workflow + Notifications (migrate_014)');
  check('schema_migrations', await hasTable('schema_migrations'), 'run npm run migrate-db');
  check('customer_notification_outbox', await hasTable('customer_notification_outbox'), 'run migrate_014');
  check('riders.user_id', await hasColumn('riders', 'user_id'), 'run migrate_014');
  check('orders.rider_id', await hasColumn('orders', 'rider_id'), 'run migrate_011 + migrate_014');
  check('riders.uq_riders_user', await hasIndex('riders', 'uq_riders_user'), 'run migrate_014');
  check('notification pending index', await hasIndex('customer_notification_outbox', 'idx_notification_pending'), 'run migrate_014');
  check('shipping_rates.price_per_kg', await hasColumn('shipping_rates', 'price_per_kg'), 'run migrate_016');
  const [[legacyStatuses]] = await pool.query(
    `SELECT COUNT(*) AS count FROM orders
     WHERE status IN ('ON_TRUCK_BORDER','READY_TO_LOAD','PENDING_CUSTOMS','SCREENING_FAILED',
                      'ASSIGNED_TO_RIDER','ACCEPTED_BY_RIDER','PICKED_UP_BY_RIDER')`
  );
  check('orders use canonical statuses', Number(legacyStatuses.count) === 0, `${legacyStatuses.count} legacy rows remain`);

  // ────────────────────────────────────────────────────────────────
  // SUMMARY
  // ────────────────────────────────────────────────────────────────
  const total = totalPass + totalFail;
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  สรุปผล: ${totalPass}/${total} passed                                  `.substring(0,62) + '║');
  if (totalFail === 0) {
    console.log('║  🎉 DB Migration สมบูรณ์ 100% — พร้อมเข้าเฟส 2          ║');
  } else {
    console.log(`║  ⚠️  พบปัญหา ${totalFail} รายการ — ต้องแก้ก่อนดำเนินต่อ             `.substring(0,62) + '║');
    process.exitCode = 1;
  }
  console.log('╚══════════════════════════════════════════════════════════╝\n');
}

run()
  .catch(err => {
    console.error('\n[FATAL] ไม่สามารถเชื่อมต่อ Database:', err.message);
    console.error('→ ตรวจสอบ .env และ MySQL server ว่าทำงานอยู่\n');
    process.exitCode = 1;
  })
  .finally(() => pool.end());
