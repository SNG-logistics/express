import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';

const NEW_PASSWORD = 'Admin@1234';
const TARGET_USER  = 'admin';  // เปลี่ยนตรงนี้ถ้าต้องการ reset user อื่น

const hash = await bcrypt.hash(NEW_PASSWORD, 12);

const c = await mysql.createConnection({
  host: '127.0.0.1', port: 3306,
  user: 'root', password: 'Rh4kbuko', database: 'sng_logistics'
});

const [result] = await c.query(
  'UPDATE users SET password_hash = ? WHERE username = ?',
  [hash, TARGET_USER]
);

if (result.affectedRows > 0) {
  console.log(`\n✅ รีเซ็ตรหัสผ่านสำเร็จ`);
  console.log(`   username : ${TARGET_USER}`);
  console.log(`   password : ${NEW_PASSWORD}`);
  console.log(`   \n⚠️  เปลี่ยนรหัสผ่านใหม่หลัง login แล้ว!\n`);
} else {
  console.error(`❌ ไม่พบ user: ${TARGET_USER}`);
}

await c.end();
