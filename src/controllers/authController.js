/**
 * authController.js — Authentication controller
 *
 * Security hardening applied:
 *  - loginRateLimit middleware (imported from auth.js) called via route
 *  - recordLoginAttempt called on every attempt (success/fail)
 *  - regenerateSession() used instead of manually setting req.session.user
 *    — prevents session-fixation attacks
 *  - post-login redirect honours returnTo (set by requireLogin)
 */
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { recordLoginAttempt, regenerateSession } from '../middleware/auth.js';

export async function showLogin(req, res) {
  if (req.session?.user) return res.redirect('/dashboard');
  res.render('auth/login', { flash: null, title: 'เข้าสู่ระบบ' });
}

export async function login(req, res) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';

  try {
    const { username, password } = req.body;

    if (!username?.trim() || !password) {
      return res.render('auth/login', {
        flash: { type: 'error', message: 'กรุณากรอก Username และ Password' },
        title: 'เข้าสู่ระบบ',
      });
    }

    const [rows] = await pool.query(
      'SELECT * FROM users WHERE username = ? AND status = "active" LIMIT 1',
      [username.trim()]
    );
    const user = rows[0];

    // Constant-time response even if user not found (resist user-enumeration)
    const dummyHash = '$2b$10$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const ok = user
      ? await bcrypt.compare(password, user.password_hash)
      : await bcrypt.compare(password, dummyHash).then(() => false);

    if (!user || !ok) {
      recordLoginAttempt(ip, false); // increment fail counter
      return res.render('auth/login', {
        flash: { type: 'error', message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' },
        title: 'เข้าสู่ระบบ',
      });
    }

    // ── Success ──────────────────────────────────────────────────────────
    recordLoginAttempt(ip, true); // clear fail counter

    const payload = {
      id:       user.id,
      username: user.username,
      role:     user.role,
      name:     user.name,
      // Include branch_id for branch_operator role
      branch_id: user.branch_id || null,
    };

    const returnTo = req.session.returnTo || '/dashboard';

    // Regenerate session to prevent session-fixation
    regenerateSession(req, payload, (err) => {
      if (err) {
        console.error('[AUTH] Session regenerate error:', err);
        return res.render('auth/login', {
          flash: { type: 'error', message: 'เกิดข้อผิดพลาดในการบันทึกเซสชัน' },
          title: 'เข้าสู่ระบบ',
        });
      }
      res.redirect(returnTo);
    });

  } catch (err) {
    console.error('[AUTH] Login error:', err);
    recordLoginAttempt(ip, false);
    res.render('auth/login', {
      flash: { type: 'error', message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ กรุณาลองใหม่ภายหลัง' },
      title: 'เข้าสู่ระบบ',
    });
  }
}

export function logout(req, res) {
  req.session.destroy(() => res.redirect('/login'));
}
