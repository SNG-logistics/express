/**
 * scripts/seed_owner.mjs — create/reset the system OWNER account.
 *
 *   node scripts/seed_owner.mjs [username] [password]
 *   OWNER_USER=owner OWNER_PASS='...' node scripts/seed_owner.mjs
 *
 * role='owner' is the wildcard superset — it passes every guard and can walk
 * through every step of the system for end-to-end testing. Idempotent: re-running
 * updates the password + re-activates the account.
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const username = process.argv[2] || process.env.OWNER_USER || 'owner';
const password = process.argv[3] || process.env.OWNER_PASS;
const name = process.env.OWNER_NAME || 'เจ้าของระบบ';

// No hard-coded default — the password must be supplied so it never lives in the repo.
if (!password || password.length < 8) {
  console.error('Usage: node scripts/seed_owner.mjs [username] <password>   (or set OWNER_PASS)');
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

let host = process.env.DB_HOST || '127.0.0.1';
if (host === 'localhost') host = '127.0.0.1';

const conn = await mysql.createConnection({
  host,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'sng_logistics',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

try {
  const hash = await bcrypt.hash(password, 12);
  const [[existing]] = await conn.query('SELECT id FROM users WHERE username = ?', [username]);

  if (existing) {
    await conn.query(
      "UPDATE users SET password_hash=?, role='owner', status='active', name=COALESCE(name, ?) WHERE username=?",
      [hash, name, username]
    );
    console.log(`✅ Updated existing user "${username}" → role=owner, status=active, password reset`);
  } else {
    await conn.query(
      "INSERT INTO users (username, password_hash, role, name, status) VALUES (?, ?, 'owner', ?, 'active')",
      [username, hash, name]
    );
    console.log(`✅ Created owner user "${username}"`);
  }

  console.log('────────────────────────────────');
  console.log(`  Username: ${username}`);
  console.log(`  Password: ${password}`);
  console.log(`  Role:     owner (เห็น/ทำได้ทุกขั้นตอน)`);
  console.log('────────────────────────────────');
  console.log('  ⚠️  เปลี่ยนรหัสผ่านหลังล็อกอินครั้งแรก');
} catch (err) {
  console.error('❌ ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
