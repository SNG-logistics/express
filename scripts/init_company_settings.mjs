import pool from '../src/config/db.js';

const defaults = [
  ['company_name', 'SNG Express'],
  ['company_address', ''],
  ['company_phone', ''],
  ['company_logo', '/images/snglogo.png'],
  ['company_tax_id', ''],
  ['company_email', ''],
];

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS company_settings (
      id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      setting_key VARCHAR(80) NOT NULL UNIQUE,
      setting_value TEXT NULL,
      updated_by INT UNSIGNED NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  for (const [key, value] of defaults) {
    await pool.query(
      'INSERT IGNORE INTO company_settings (setting_key, setting_value) VALUES (?, ?)',
      [key, value]
    );
  }
  console.log('✅ company_settings table created and seeded');
} finally {
  await pool.end();
}
