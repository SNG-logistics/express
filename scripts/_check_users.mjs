import pool from '../src/config/db.js';

try {
  const [cols] = await pool.query('DESCRIBE users');
  console.table(cols.map(row => ({ Field: row.Field, Type: row.Type, Null: row.Null })));
} finally {
  await pool.end();
}
