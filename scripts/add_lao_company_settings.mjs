import mysql from 'mysql2/promise';

const c = await mysql.createConnection({
  host: '127.0.0.1', port: 3306,
  user: 'root', password: 'Rh4kbuko', database: 'sng_logistics'
});

// เพิ่ม keys ฝั่งลาว + rename ของเดิมให้ชัดเจนเป็น _th
const laoDefaults = [
  // ไทย (เพิ่ม suffix _th ให้ชัดขึ้น — INSERT IGNORE จะไม่ทับของเดิม)
  ['company_name_th',    'SNG Express'],
  ['company_address_th', ''],
  ['company_phone_th',   ''],
  ['company_tax_id_th',  ''],
  ['company_email_th',   ''],
  // ลาວ
  ['company_name_la',    'SNG Express'],
  ['company_address_la', ''],
  ['company_phone_la',   ''],
  ['company_tax_id_la',  ''],
  ['company_email_la',   ''],
];

for (const [k, v] of laoDefaults) {
  await c.query(
    'INSERT IGNORE INTO company_settings (setting_key, setting_value) VALUES (?, ?)',
    [k, v]
  );
}

console.log('✅ เพิ่ม fields ฝั่ง TH/LA สำเร็จ');

const [rows] = await c.query('SELECT setting_key, setting_value FROM company_settings ORDER BY id');
console.table(rows);

await c.end();
