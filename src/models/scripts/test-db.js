import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

async function test() {
    console.log(`Testing connection to ${process.env.DB_HOST}:${process.env.DB_PORT} as ${process.env.DB_USER}`);
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT || 3308,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
        });
        console.log('Successfully connected to MySQL server!');
        await connection.end();
    } catch (err) {
        console.error('Connection failed:', err.message);
        if (err.code === 'ECONNREFUSED') {
            console.error('Hint: Make sure your MySQL server is running properly on localhost:3308');
        } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('Hint: Check your username and password in .env');
        }
    }
}

test();
