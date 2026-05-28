
import pool from '../src/config/db.js';

async function migrate() {
    try {
        console.log('Checking if price_per_kg column exists...');
        const [rows] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'orders' 
      AND COLUMN_NAME = 'price_per_kg'
    `);

        if (rows.length === 0) {
            console.log('Adding price_per_kg column...');
            await pool.query(`
        ALTER TABLE orders
        ADD COLUMN price_per_kg DECIMAL(10,2) NULL AFTER actual_size
      `);
            console.log('Column added successfully.');
        } else {
            console.log('Column price_per_kg already exists.');
        }
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
