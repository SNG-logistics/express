// In ESM, this file is evaluated when imported — before any code in app.js runs.
// So we must load dotenv here, not rely on app.js to load it first.
import 'dotenv/config';
import mysql from 'mysql2/promise';

if (!process.env.DB_HOST) {
  console.warn('[DB] WARNING: DB_HOST not set in .env — using default 127.0.0.1');
}

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || '127.0.0.1',
  port:     Number(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASS     || '',
  database: process.env.DB_NAME     || 'sng_logistics',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 5,
  namedPlaceholders: true
});

export default pool;
