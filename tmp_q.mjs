import pool from './src/config/db.js';
import bcrypt from 'bcrypt';

const PASS = 'dev1234';
const hash = await bcrypt.hash(PASS, 10);

// roles ทั้งหมดใน enum ของ DB
const TEST_USERS = [
  { username: 'dev_manager',    role: 'manager',          name: '[DEV] Manager' },
  { username: 'dev_dispatcher', role: 'dispatcher',       name: '[DEV] Dispatcher' },
  { username: 'dev_finance',    role: 'finance',          name: '[DEV] Finance' },
  { username: 'dev_wh_th',      role: 'warehouse_th',     name: '[DEV] Warehouse TH' },
  { username: 'dev_wh_la',      role: 'warehouse_la',     name: '[DEV] Warehouse LA' },
  { username: 'dev_customs',    role: 'customs',          name: '[DEV] Customs' },
  { username: 'dev_staff',      role: 'staff',            name: '[DEV] Staff' },
  { username: 'dev_cs',         role: 'customer_service', name: '[DEV] Customer Service' },
  { username: 'dev_branch',     role: 'branch_operator',  name: '[DEV] Branch Operator' },
  { username: 'dev_driver',     role: 'driver_support',   name: '[DEV] Driver Support' },
];

console.log(`\n=== SEEDING TEST USERS (password: ${PASS}) ===`);

for (const u of TEST_USERS) {
  const [[exists]] = await pool.query('SELECT id FROM users WHERE username=?', [u.username]);
  if (exists) {
    await pool.query(
      'UPDATE users SET role=?, password_hash=?, name=?, status="active" WHERE username=?',
      [u.role, hash, u.name, u.username]
    );
    console.log(` ✏ UPDATED | ${u.username.padEnd(20)} | ${u.role}`);
  } else {
    await pool.query(
      'INSERT INTO users (username, password_hash, role, name, status) VALUES (?,?,?,?,"active")',
      [u.username, hash, u.role, u.name]
    );
    console.log(` ✅ CREATED | ${u.username.padEnd(20)} | ${u.role}`);
  }
}

// อัปเดต admin password ด้วย
await pool.query('UPDATE users SET password_hash=?, status="active" WHERE username="admin"', [hash]);
console.log(` ✏ UPDATED | admin               | admin (password reset to ${PASS})`);

const [after] = await pool.query('SELECT username, role, name, status FROM users ORDER BY role, username');
console.log('\n=== LOGIN CREDENTIALS ===');
console.log('┌────────────────────┬──────────────────────┬──────────┐');
console.log('│ Username           │ Role                 │ Password │');
console.log('├────────────────────┼──────────────────────┼──────────┤');
after.forEach(u => {
  console.log(`│ ${u.username.padEnd(18)} │ ${u.role.padEnd(20)} │ ${PASS}   │`);
});
console.log('└────────────────────┴──────────────────────┴──────────┘');

pool.end();
