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
    // Import the existing pool from your project configuration
    // Adjust the path if necessary to point to your actual db.js file
    const dbModule = await import('../src/config/db.js');
    const pool = dbModule.default || dbModule.pool;

    let connection;
    try {
        connection = await pool.getConnection();

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
        if (connection) connection.release();
        // We don't need to end the pool here necessarily if using shared pool, 
        // but for a standalone script, we can force exit or close pool.
        process.exit(0);
    }

    console.log('\n✨ Migration Complete! You can now restart the server.');
}

migrate();
