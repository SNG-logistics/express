import pool from '../src/config/db.js';

async function migrate() {
    try {
        console.log('Modifying users.role ENUM...');
        await pool.query(`
      ALTER TABLE users 
      MODIFY COLUMN role ENUM('admin','staff','manager','thai_warehouse','lao_warehouse') NOT NULL DEFAULT 'staff'
    `);
        console.log('Successfully updated users table.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
