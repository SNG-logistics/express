import mysql from 'mysql2/promise';

const c = await mysql.createConnection({
  host: '127.0.0.1', port: 3306,
  user: 'root', password: 'Rh4kbuko', database: 'sng_logistics'
});

await c.query(`
  CREATE TABLE IF NOT EXISTS company_settings (
    id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(80)  NOT NULL UNIQUE,
    setting_value TEXT        NULL,
    updated_by  INT UNSIGNED NULL,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

const defaults = [
  ['company_name',    'SNG Express'],
  ['company_address', ''],
  ['company_phone',   ''],
  ['company_logo',    '/images/snglogo.png'],
  ['company_tax_id',  ''],
  ['company_email',   ''],
];

for (const [k, v] of defaults) {
  await c.query(
    'INSERT IGNORE INTO company_settings (setting_key, setting_value) VALUES (?, ?)',
    [k, v]
  );
}

console.log('✅ company_settings table created & seeded');
await c.end();
