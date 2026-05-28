import pool from '../src/config/db.js';

async function addColumnIfMissing(table, column, definition) {
  const [cols] = await pool.query(`DESCRIBE ${table}`);
  const exists = cols.some(c => c.Field === column);
  if (exists) {
    console.log(`  ⏭  ${table}.${column} — already exists`);
  } else {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`  ✅ ${table}.${column} — added`);
  }
}

console.log('\nRunning migration: align trips + orders schema with dashboardModel...\n');

// trips — columns expected by dashboardModel.js
await addColumnIfMissing('trips', 'direction',       "ENUM('TH_TO_LA','LA_TO_TH') NULL");
await addColumnIfMissing('trips', 'max_weight',      'DECIMAL(8,2) NULL');
await addColumnIfMissing('trips', 'notes',           'TEXT NULL');

// orders — expected by ordersController / model
await addColumnIfMissing('orders', 'branch_id',      'BIGINT UNSIGNED NULL');
await addColumnIfMissing('orders', 'notes',          'TEXT NULL');

console.log('\nMigration complete.\n');
process.exit(0);
