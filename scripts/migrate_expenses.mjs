import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';

async function migrate() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  try {
    console.log('Creating expenses table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        category ENUM('CAPITAL', 'TRIP', 'ADMIN') NOT NULL,
        type VARCHAR(120) NOT NULL,
        description TEXT,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        paid_by VARCHAR(120) DEFAULT NULL,
        expense_date DATE NOT NULL,
        trip_id BIGINT UNSIGNED DEFAULT NULL,
        receipt_image VARCHAR(255) DEFAULT NULL,
        created_by BIGINT UNSIGNED DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        -- Not enforcing foreign key on trip_id strictly if trips might be deleted, but let's add it for safety
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Add foreign key for trip_id if trips table exists
    try {
      await db.query(`
        ALTER TABLE expenses 
        ADD CONSTRAINT fk_expenses_trip 
        FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE SET NULL;
      `);
      console.log('Added foreign key for trip_id.');
    } catch (fkErr) {
      if (fkErr.code === 'ER_DUP_KEYNAME') {
         console.log('Foreign key already exists.');
      } else {
         console.warn('Could not add FK for trip_id (maybe trips table structure issue):', fkErr.message);
      }
    }

    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await db.end();
  }
}

migrate();
