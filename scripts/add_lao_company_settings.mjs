import pool from '../src/config/db.js';

const laoDefaults = [
  ['company_name_th', 'SNG Express'],
  ['company_address_th', ''],
  ['company_phone_th', ''],
  ['company_tax_id_th', ''],
  ['company_email_th', ''],
  ['company_name_la', 'SNG Express'],
  ['company_address_la', ''],
  ['company_phone_la', ''],
  ['company_tax_id_la', ''],
  ['company_email_la', ''],
];

try {
  for (const [key, value] of laoDefaults) {
    await pool.query(
      'INSERT IGNORE INTO company_settings (setting_key, setting_value) VALUES (?, ?)',
      [key, value]
    );
  }
  console.log('✅ เพิ่ม fields ฝั่ง TH/LA สำเร็จ');
  const [rows] = await pool.query(
    'SELECT setting_key, setting_value FROM company_settings ORDER BY id'
  );
  console.table(rows);
} finally {
  await pool.end();
}
