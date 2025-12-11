import bcrypt from 'bcrypt';
import pool from '../config/db.js';

export async function index(req, res) {
    try {
        const [users] = await pool.query('SELECT id, username, role, name, status, created_at FROM users ORDER BY created_at DESC');
        res.render('users/index', {
            users,
            user: req.session.user,
            title: 'จัดการผู้ใช้งาน',
            error: null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading users');
    }
}

export async function create(req, res) {
    const { username, password, name, role } = req.body;
    if (!username || !password || !name) {
        req.session.flash = { type: 'error', message: 'กรุณากรอกข้อมูลให้ครบถ้วน' };
        return res.redirect('/users');
    }

    try {
        const passwordHash = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)',
            [username, passwordHash, name, role || 'staff', 'active']
        );
        req.session.flash = { type: 'success', message: 'เพิ่มผู้ใช้งานเรียบร้อยแล้ว' };
        res.redirect('/users');
    } catch (err) {
        console.error(err);
        req.session.flash = { type: 'error', message: 'ชื่อผู้ใช้ซ้ำหรือเกิดข้อผิดพลาด' };
        res.redirect('/users');
    }
}

export async function resetPassword(req, res) {
    const { id } = req.params;
    const { new_password } = req.body;

    if (!new_password) {
        req.session.flash = { type: 'error', message: 'กรุณาระบุรหัสผ่านใหม่' };
        return res.redirect('/users');
    }

    try {
        const passwordHash = await bcrypt.hash(new_password, 10);
        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
        req.session.flash = { type: 'success', message: 'รีเซ็ตรหัสผ่านเรียบร้อยแล้ว' };
        res.redirect('/users');
    } catch (err) {
        console.error(err);
        req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาด' };
        res.redirect('/users');
    }
}

export async function destroy(req, res) {
    const { id } = req.params;
    // Prevent deleting self
    if (req.session.user.id == id) {
        req.session.flash = { type: 'error', message: 'ไม่สามารถลบบัญชีตัวเองได้' };
        return res.redirect('/users');
    }

    try {
        await pool.query('DELETE FROM users WHERE id = ?', [id]);
        req.session.flash = { type: 'success', message: 'ลบผู้ใช้งานเรียบร้อยแล้ว' };
        res.redirect('/users');
    } catch (err) {
        console.error(err);
        req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาดในการลบ (อาจมีข้อมูลเชื่อมโยง)' };
        res.redirect('/users');
    }
}
