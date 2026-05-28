import pool from './src/config/db.js';

console.log('=== Fixing rider role on Production ===\n');

// 1. Check current ENUM
const [cols] = await pool.query("SHOW COLUMNS FROM users WHERE Field = 'role'");
const enumType = cols[0]?.Type || '';
console.log('Current role ENUM:', enumType);

const hasRider = enumType.includes("'rider'");
console.log('Has rider in ENUM:', hasRider);

// 2. Add 'rider' to ENUM if missing
if (!hasRider) {
  console.log('\nAdding rider to ENUM...');
  try {
    await pool.query(`
      ALTER TABLE users MODIFY COLUMN role 
      ENUM('admin','staff','manager','thai_warehouse','lao_warehouse',
           'dispatcher','customer_service','finance','branch_operator',
           'rider','warehouse_th','warehouse_la','customs','driver_support')
      NOT NULL DEFAULT 'staff'
    `);
    console.log('✅ rider added to ENUM');
  } catch(e) {
    console.log('⏭ ENUM update:', e.message);
  }
} else {
  console.log('✅ rider already in ENUM');
}

// 3. Check rider_01 user
const [riders] = await pool.query("SELECT id, username, role, status FROM users WHERE username LIKE '%rider%' OR role = 'rider'");
console.log('\nRider users in DB:', JSON.stringify(riders, null, 2));

// 4. Fix rider_01 if role is empty/wrong
for (const u of riders) {
  if (u.role !== 'rider') {
    console.log(`\nFixing ${u.username}: role="${u.role}" → "rider"`);
    await pool.query("UPDATE users SET role='rider', status='active' WHERE id=?", [u.id]);
    console.log('✅ Fixed!');
  }
}

// 5. Final check
const [all] = await pool.query("SELECT id, username, role, status FROM users WHERE username LIKE '%rider%' OR role = 'rider'");
console.log('\nFinal state:', JSON.stringify(all, null, 2));

process.exit(0);
