import bcrypt from 'bcrypt';
import pool from '../config/db.js';

export async function showLogin(req, res) {
  res.render('auth/login', { error: null, title: 'เข้าสู่ระบบ' });
}

export async function login(req, res) {
  try {
    const { username, password } = req.body;
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE username = ? AND status = "active" LIMIT 1',
      [username]
    );
    const user = rows[0];
    if (!user) return res.render('auth/login', { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', title: 'เข้าสู่ระบบ' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.render('auth/login', { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', title: 'เข้าสู่ระบบ' });

    req.session.user = { id: user.id, username: user.username, role: user.role, name: user.name };

    // Force save session before redirect to prevent race conditions
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.render('auth/login', { error: 'เกิดข้อผิดพลาดในการบันทึกเซสชัน', title: 'เข้าสู่ระบบ' });
      }
      res.redirect('/dashboard');
    });
  } catch (error) {
    console.error('Login error:', error);
    res.render('auth/login', { error: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ กรุณาลองใหม่ภายหลัง', title: 'เข้าสู่ระบบ' });
  }
}

export function logout(req, res) {
  req.session.destroy(() => res.redirect('/login'));
}
