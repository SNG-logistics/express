import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

async function check() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
        });

        const [rows] = await connection.query(`SHOW DATABASES LIKE '${process.env.DB_NAME}'`);

        if (rows.length > 0) {
            console.log(`Database ${process.env.DB_NAME} EXISTS.`);
            // Check for tables
            await connection.changeUser({ database: process.env.DB_NAME });
            const [tables] = await connection.query('SHOW TABLES');
            console.log(`Found ${tables.length} tables.`);
        } else {
            console.log(`Database ${process.env.DB_NAME} does NOT exist.`);
        }

        await connection.end();
    } catch (err) {
        console.error('Error:', err.message);
    }
}

check();
