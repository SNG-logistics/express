import pool from './src/config/db.js';

// Check rider users
const [riders] = await pool.query("SELECT id, username, role, status FROM users WHERE username LIKE '%rider%' OR role = 'rider'");
console.log('Rider users:', JSON.stringify(riders, null, 2));

// Check ENUM values allowed for role column
const [cols] = await pool.query("SHOW COLUMNS FROM users WHERE Field = 'role'");
console.log('\nRole column type:', cols[0]?.Type);

process.exit(0);
