import bcrypt from 'bcrypt';
import pool from '../src/config/db.js';

const targetUser = process.env.RESET_USERNAME || 'admin';
const newPassword = process.env.RESET_PASSWORD;
if (!newPassword || newPassword.length < 12) {
  console.error('Set RESET_PASSWORD to a value of at least 12 characters.');
  process.exitCode = 1;
} else {
  try {
    const hash = await bcrypt.hash(newPassword, 12);
    const [result] = await pool.query(
      'UPDATE users SET password_hash=? WHERE username=?',
      [hash, targetUser]
    );
    if (result.affectedRows > 0) {
      console.log(`✅ Reset password for ${targetUser}. Change it again after login.`);
    } else {
      console.error(`❌ User not found: ${targetUser}`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}
