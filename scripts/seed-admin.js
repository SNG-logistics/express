import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import pool from '../src/config/db.js';

dotenv.config();

async function main() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'Admin@123';
  const name = process.env.ADMIN_NAME || 'Administrator';
  const role = 'admin';

  if (!password || password.length < 6) {
    throw new Error('ADMIN_PASSWORD must be set and at least 6 characters');
  }

  const hash = await bcrypt.hash(password, 10);

  const sql = `
    INSERT INTO users (username, password_hash, role, name, status)
    VALUES (?, ?, ?, ?, 'active')
    ON DUPLICATE KEY UPDATE
      password_hash = VALUES(password_hash),
      role = VALUES(role),
      name = VALUES(name),
      status = 'active';
  `;

  await pool.query(sql, [username, hash, role, name]);
  console.log(`Seeded admin user "${username}" with role=${role}`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('Seed error:', err.message);
    await pool.end();
    process.exit(1);
  });
