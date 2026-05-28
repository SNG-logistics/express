import pool from './src/config/db.js';

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS delivery_events (
      id         INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_id   INT NOT NULL,
      rider_id   INT NOT NULL,
      event_type ENUM('ASSIGNED','ACCEPTED','PICKED_UP','DEPARTED','ARRIVED_CUSTOMER','DELIVERED','FAILED','NOTE') NOT NULL,
      note       TEXT NULL,
      lat        DECIMAL(10,8) NULL,
      lng        DECIMAL(11,8) NULL,
      photo_url  VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT NOW(),
      INDEX idx_order (order_id),
      INDEX idx_rider (rider_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ delivery_events table: OK');
  
  // Add rider_id column to orders if missing
  try {
    await pool.query('ALTER TABLE orders ADD COLUMN rider_id INT NULL');
    console.log('✅ rider_id column added');
  } catch(e) {
    console.log('⏭ rider_id:', e.code);
  }
  
  // Add index
  try {
    await pool.query('ALTER TABLE orders ADD INDEX idx_rider_id (rider_id)');
    console.log('✅ idx_rider_id index added');
  } catch(e) {
    console.log('⏭ idx_rider_id:', e.code);
  }
  
  console.log('\n✅ Migration 011 complete!');
} catch(e) {
  console.error('❌', e.message);
}
process.exit(0);
