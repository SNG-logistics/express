import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrate() {
    console.log('🚀 Starting Migration for Image Upload Feature...');

    // 1. Create Upload Directory
    const uploadDir = path.join(__dirname, '../public/uploads/orders');
    try {
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
            console.log('✅ Created directory: public/uploads/orders');
        } else {
            console.log('info: Upload directory already exists.');
        }
    } catch (err) {
        console.error('❌ Failed to create directory:', err.message);
    }

    // 2. Update Database
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT
    });

    try {
        // Check if column exists
        const [columns] = await connection.query(`SHOW COLUMNS FROM orders LIKE 'image_path'`);

        if (columns.length === 0) {
            console.log('📦 Adding image_path column to orders table...');
            await connection.query(`ALTER TABLE orders ADD COLUMN image_path VARCHAR(255) DEFAULT NULL AFTER status`);
            console.log('✅ Database updated successfully.');
        } else {
            console.log('info: image_path column already exists.');
        }

    } catch (error) {
        console.error('❌ Database migration failed:', error.message);
    } finally {
        await connection.end();
    }

    console.log('\n✨ Migration Complete! You can now restart the server.');
}

migrate();
