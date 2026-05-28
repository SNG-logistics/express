import pool from './src/config/db.js';

try {
  const sql = "ALTER TABLE expenses MODIFY COLUMN currency ENUM('THB','LAK','USD') NOT NULL DEFAULT 'THB'";
  const [result] = await pool.query(sql);
  console.log('SUCCESS - currency column updated to include USD');
  console.log('Message:', result.message || 'Done');
} catch (err) {
  console.error('ERROR:', err.message);
} finally {
  process.exit(0);
}
