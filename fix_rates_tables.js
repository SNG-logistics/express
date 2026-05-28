/**
 * fix_rates_tables.js
 * สร้าง table exchange_rates และ company_settings ถ้ายังไม่มีใน Production DB
 */
import pool from './src/config/db.js';

console.log('=== Fix: Settings / Rates Tables ===\n');

// 1. exchange_rates
try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exchange_rates (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      currency    VARCHAR(10)    NOT NULL DEFAULT 'LAK',
      rate        DECIMAL(12,4)  NOT NULL,
      note        VARCHAR(255)   NULL,
      set_by      INT            NULL,
      created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (set_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ exchange_rates table: OK');
} catch(e) {
  console.log('⏭  exchange_rates:', e.message);
}

// 2. company_settings
try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_settings (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      setting_key   VARCHAR(100) NOT NULL UNIQUE,
      setting_value TEXT         NULL,
      updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ company_settings table: OK');
} catch(e) {
  console.log('⏭  company_settings:', e.message);
}

// 3. Insert default company settings if empty
try {
  const [[cnt]] = await pool.query('SELECT COUNT(*) as c FROM company_settings');
  if (cnt.c === 0) {
    await pool.query(`
      INSERT INTO company_settings (setting_key, setting_value) VALUES
        ('company_name',    'SNG Logistics Express'),
        ('company_phone',   '083-754-3623'),
        ('company_address', 'Vientiane, Laos'),
        ('company_email',   ''),
        ('company_tax_id',  ''),
        ('default_currency','THB')
    `);
    console.log('✅ Default company_settings inserted');
  } else {
    console.log('✅ company_settings already has data:', cnt.c, 'rows');
  }
} catch(e) {
  console.log('⏭  company_settings insert:', e.message);
}

// 4. Verify
console.log('\n=== Verification ===');
const [t1] = await pool.query("SHOW TABLES LIKE '%exchange_rates%'");
const [t2] = await pool.query("SHOW TABLES LIKE '%company_settings%'");
console.log('exchange_rates:', t1.length > 0 ? '✅' : '❌');
console.log('company_settings:', t2.length > 0 ? '✅' : '❌');

console.log('\n✅ Fix complete! Restart App แล้วเข้า /settings/rates ได้เลย');
process.exit(0);
