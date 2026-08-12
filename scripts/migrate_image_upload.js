import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrate() {
    console.log('🚀 เริ่มต้นการย้ายข้อมูลสำหรับระบบอัปโหลดรูปภาพ...');

    // 1. Create Upload Directory
    const uploadDir = path.join(__dirname, '../public/uploads/orders');
    try {
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
            console.log('✅ สร้างโฟลเดอร์เรียบร้อยแล้ว: public/uploads/orders');
        } else {
            console.log('ข้อมูล: โฟลเดอร์สำหรับอัปโหลดมีอยู่แล้ว');
        }
    } catch (err) {
        console.error('❌ ไม่สามารถสร้างโฟลเดอร์ได้:', err.message);
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
            console.log('📦 กำลังเพิ่มคอลัมน์ image_path ในตาราง orders...');
            await connection.query(`ALTER TABLE orders ADD COLUMN image_path VARCHAR(255) DEFAULT NULL AFTER status`);
            console.log('✅ อัปเดตฐานข้อมูลสำเร็จ');
        } else {
            console.log('ข้อมูล: คอลัมน์ image_path มีอยู่แล้ว');
        }

    } catch (error) {
        console.error('❌ การย้ายข้อมูลฐานข้อมูลล้มเหลว:', error.message);
    } finally {
        if (connection) connection.release();
        // We don't need to end the pool here necessarily if using shared pool, 
        // but for a standalone script, we can force exit or close pool.
        process.exit(0);
    }

    console.log('\n✨ การย้ายข้อมูลเสร็จสมบูรณ์! คุณสามารถรีสตาร์ทเซิร์ฟเวอร์ได้แล้ว');
}

migrate();
