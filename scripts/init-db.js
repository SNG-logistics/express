import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

async function init() {
    console.log('Initializing Database...');
    try {
        // Connect to server (no DB)
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
        });

        // Create Database
        console.log(`Creating database ${process.env.DB_NAME}...`);
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        console.log('Database created.');

        // Use Database
        await connection.changeUser({ database: process.env.DB_NAME });

        // Read Schema
        const schemaPath = path.join(__dirname, '../database/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        // Split by semicolon and run each query
        // Basic split, might be fragile if SQL content has semicolons in strings, but schema.sql looked simple enough
        const queries = schema
            .split(';')
            .map(q => q.trim())
            .filter(q => q.length > 0);

        console.log(`Running ${queries.length} schema queries...`);
        for (const query of queries) {
            await connection.query(query);
        }

        console.log('Schema imported successfully.');
        await connection.end();

    } catch (err) {
        console.error('Initialization failed:', err.message);
        process.exit(1);
    }
}

init();
