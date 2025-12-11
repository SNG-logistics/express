import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise'; // Direct import to test config
import bcrypt from 'bcrypt';

// Explicitly load .env from root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

import pool from '../src/config/db.js';

async function seedAdmin() {
    try {
        console.log('--- Configuration Check ---');
        console.log('DB_HOST:', process.env.DB_HOST || '(undefined - using default)');
        console.log('DB_USER:', process.env.DB_USER || '(undefined - using default)');
        console.log('DB_NAME:', process.env.DB_NAME || '(undefined - using default)');
        console.log('DB_PORT:', process.env.DB_PORT || '(undefined - using default 3308)');
        console.log('---------------------------');

        const username = 'admin';
        const password = 'password123';
        const role = 'admin';
        const status = 'active';

        console.log(`Checking for user: ${username}...`);

        // Test connection specifically
        const [existing] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        if (existing.length > 0) {
            await pool.query('UPDATE users SET password_hash = ?, status = ?, role = ? WHERE username = ?', [hash, status, role, username]);
            console.log('Admin user updated successfully.');
        } else {
            await pool.query('INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, ?, ?', [username, hash, role, status]);
            console.log('Admin user created successfully.');
        }
        console.log('-----------------------------------');
        console.log(`Login with -> Username: ${username} | Password: ${password}`);
        console.log('-----------------------------------');
    } catch (err) {
        console.error('CRITICAL ERROR:', err.message);
        if (err.code === 'ECONNREFUSED') {
            console.error('Suggested Fix: Check your Database Host and Port in .env file');
        } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('Suggested Fix: Check your Database Username and Password in .env file');
        }
    } finally {
        process.exit();
    }
}

seedAdmin();
