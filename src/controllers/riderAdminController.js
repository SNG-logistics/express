/**
 * src/controllers/riderAdminController.js — manage riders who work out of the
 * main warehouse (branch_id IS NULL), not a branch hub.
 *
 * Mirrors branchesController.js's rider CRUD (createRider/updateRiderStatus)
 * but without a branch context — gated to admin/manager only since there's no
 * "own branch" to scope a branch_operator to.
 */
import pool from '../config/db.js';
import bcrypt from 'bcryptjs';
import { withTransaction, WorkflowError } from '../services/orderWorkflowService.js';

export async function index(req, res) {
  const [riders] = await pool.query(
    `SELECT r.id, r.name, r.phone, r.vehicle_type, r.vehicle_no, r.status, r.created_at
     FROM riders r
     WHERE r.branch_id IS NULL
     ORDER BY r.created_at DESC`
  );
  res.render('riders/index', { title: 'ไรเดอร์คลังใหญ่', riders, error: null });
}

export async function create(req, res) {
  const { name, phone, vehicle_type, vehicle_no, username, password } = req.body;
  if (!name?.trim() || !phone?.trim() || !username?.trim() || !password) {
    req.session.flash = { type: 'error', message: 'ต้องระบุชื่อ เบอร์โทร Username และ Password ของไรเดอร์' };
    return res.redirect('/riders');
  }
  if (password.length < 8) {
    req.session.flash = { type: 'error', message: 'Password ต้องมีอย่างน้อย 8 ตัวอักษร' };
    return res.redirect('/riders');
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await withTransaction(async (conn) => {
      const [userResult] = await conn.query(
        `INSERT INTO users (username, password_hash, role, name, phone, status, branch_id)
         VALUES (?, ?, 'rider', ?, ?, 'active', NULL)`,
        [username.trim(), passwordHash, name.trim(), phone.trim()]
      );
      await conn.query(
        `INSERT INTO riders (user_id, branch_id, name, phone, vehicle_type, vehicle_no)
         VALUES (?, NULL, ?, ?, ?, ?)`,
        [userResult.insertId, name.trim(), phone.trim(), vehicle_type || 'motorcycle', vehicle_no || null]
      );
    });
    req.session.flash = { type: 'success', message: `เพิ่มไรเดอร์คลังใหญ่ ${name} และบัญชี ${username} แล้ว` };
  } catch (error) {
    req.session.flash = {
      type: 'error',
      message: error.code === 'ER_DUP_ENTRY' ? 'Username หรือบัญชีไรเดอร์นี้มีอยู่แล้ว' : error.message,
    };
  }
  res.redirect('/riders');
}

export async function updateStatus(req, res) {
  const { riderId } = req.params;
  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) {
    req.session.flash = { type: 'error', message: 'สถานะไรเดอร์ไม่ถูกต้อง' };
    return res.redirect('/riders');
  }
  try {
    await withTransaction(async (conn) => {
      const [[rider]] = await conn.query(
        'SELECT id, user_id FROM riders WHERE id=? AND branch_id IS NULL FOR UPDATE',
        [riderId]
      );
      if (!rider) throw new WorkflowError('Rider not found', 404);
      await conn.query('UPDATE riders SET status=? WHERE id=?', [status, riderId]);
      if (rider.user_id) {
        await conn.query(
          "UPDATE users SET status=? WHERE id=? AND role='rider'",
          [status === 'inactive' ? 'inactive' : 'active', rider.user_id]
        );
      }
    });
    req.session.flash = { type: 'success', message: 'อัปเดตสถานะไรเดอร์แล้ว' };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect('/riders');
}
