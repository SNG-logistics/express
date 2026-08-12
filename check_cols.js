import pool from './src/config/db.js';

try {
  const [cols] = await pool.query('SHOW COLUMNS FROM orders');
  console.log('Cols:', cols.map(column => column.Field).join(', '));
  const [tables] = await pool.query('SHOW TABLES LIKE "delivery_events"');
  console.log('delivery_events:', tables.length ? 'EXISTS' : 'NOT EXISTS');
} finally {
  await pool.end();
}
