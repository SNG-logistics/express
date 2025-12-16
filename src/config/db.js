import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Force load .env from project root (checking both ../../.env and ../../../.env just in case)
dotenv.config({ path: path.join(__dirname, '../../.env') });

const dbHost = process.env.DB_HOST || '15.235.154.180';

const pool = mysql.createPool({
  host: dbHost === 'localhost' ? '127.0.0.1' : dbHost,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'snglogis_admin1',
  password: process.env.DB_PASS || 'Aa114477+',
  database: process.env.DB_NAME || 'sng-logistics',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true
});

export default pool;
