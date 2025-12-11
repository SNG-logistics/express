import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';

// Explicitly load .env from root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '../.env');
dotenv.config({ path: envPath });

async function seedAdmin() {
    let connection;
    try {
        console.log('--- Debug: Loading Environment ---');
        console.log('Env file path:', envPath);

        // Force IPv4 if localhost is used
        let dbHost = process.env.DB_HOST;
        if (dbHost === 'localhost') {
            console.log('Detected "localhost", switching to "127.0.0.1" to avoid IPv6 issues.');
            dbHost = '127.0.0.1';
        }

        const dbConfig = {
            host: dbHost,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME,
            port: process.env.DB_PORT || 3306
        };

        console.log('Target Config:', { ...dbConfig, password: '****' });
        console.log('---------------------------');

        console.log('Step 1: Connecting to database...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected successfully!');

        const username = 'admin';
        const password = 'password123';
        const role = 'admin';
        const status = 'active';

        console.log(`Step 2: Checking for user "${username}"...`);
        const [existing] = await connection.query('SELECT * FROM users WHERE username = ?', [username]);

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        if (existing.length > 0) {
            console.log('User found. Updating password...');
            await connection.query('UPDATE users SET password_hash = ?, status = ?, role = ? WHERE username = ?', [hash, status, role, username]);
            console.log('✅ Admin user updated successfully.');
        } else {
            console.log('User not found. Creating new user...');
            await connection.query('INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, ?, ?)', [username, hash, role, status]);
            console.log('✅ Admin user created successfully.');
        }

        console.log('-----------------------------------');
        console.log(`Login with -> Username: ${username} | Password: ${password}`);
        console.log('-----------------------------------');

    } catch (err) {
        console.error('❌ CRITICAL ERROR:', err.message);
        if (err.code === 'ECONNREFUSED') {
            console.error('-> Make sure your Database Port is correct (usually 3306).');
        } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('-> Username or Password in .env is incorrect.');
        } else if (err.code === 'ER_BAD_DB_ERROR') {
            console.error('-> Database name is incorrect or does not exist.');
        }
    } finally {
        if (connection) await connection.end();
        process.exit();
    }
}

seedAdmin();
