import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Force load .env from project root (checking both ../../.env and ../../../.env just in case)
dotenv.config({ path: path.join(__dirname, '../../.env') });

const dbHost = process.env.DB_HOST || 'localhost';

const pool = mysql.createPool({
  host: dbHost,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'sng_user',
  password: process.env.DB_PASS || 'Admin1234!',
  database: process.env.DB_NAME || 'sng_logistics',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true
});

export default pool;
