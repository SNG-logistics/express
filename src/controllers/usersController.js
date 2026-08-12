/**
 * usersController.js — User management controller
 *
 * Security hardening:
 *  1. destroy() → SOFT deactivate (SET status='inactive') instead of hard DELETE
 *     Reason: users are referenced in order_status_logs.action_by —
 *     hard-delete breaks FK integrity and audit history.
 *  2. create()  → validates role against a whitelist (cannot create 'admin' via form)
 *  3. create()  → enforces minimum password length (8 chars)
 *  4. resetPassword() → minimum password length enforced
 *  5. Admin cannot deactivate their own account
 *  6. Only admin can promote to role 'manager'
 */
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { withTransaction } from '../services/orderWorkflowService.js';

/** Roles that can be assigned via the Create User form */
const ALLOWED_CREATE_ROLES = new Set([
  'staff', 'dispatcher', 'warehouse_th', 'warehouse_la',
  'customs', 'finance', 'manager', 'branch_operator', 'rider',
  'customer_service', 'driver_support', 'admin',
  'crm_admin', 'crm_supervisor', 'crm_agent', 'sales_agent',
  'logistics_support', 'finance_support'
]);

const MIN_PASSWORD_LENGTH = 8;

// ─── List ─────────────────────────────────────────────────────────────────────

export async function index(req, res) {
  try {
    const [users] = await pool.query(
      `SELECT u.id, u.username, u.role, u.name, u.status, u.created_at,
              u.branch_id, b.name AS branch_name
       FROM users u LEFT JOIN branches b ON b.id=u.branch_id
       ORDER BY u.status ASC, u.created_at DESC`
    );
    const [branches] = await pool.query("SELECT id, branch_code, name FROM branches WHERE status='active' ORDER BY name");
    res.render('users/index', {
      users,
      user: req.session.user,
      title: 'จัดการผู้ใช้งาน',
      allowedRoles: [...ALLOWED_CREATE_ROLES],
      branches,
      error: null,
    });
  } catch (err) {
    console.error('[Users.index]', err);
    res.status(500).send('Error loading users');
  }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function create(req, res) {
  const { username, password, name, role, phone, branch_id } = req.body;

  // Input validation
  if (!username?.trim() || !password || !name?.trim()) {
    req.session.flash = { type: 'error', message: 'กรุณากรอกข้อมูลให้ครบถ้วน' };
    return res.redirect('/users');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    req.session.flash = {
      type: 'error',
      message: `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`,
    };
    return res.redirect('/users');
  }

  // Role whitelist — prevent invalid roles
  const safeRole = role && ALLOWED_CREATE_ROLES.has(role) ? role : 'staff';
  const branchRequired = ['branch_operator', 'rider'].includes(safeRole);
  const branchId = branch_id ? Number(branch_id) : null;
  if (branchRequired && (!Number.isInteger(branchId) || branchId <= 0)) {
    req.session.flash = { type: 'error', message: 'Role นี้ต้องเลือกสาขา' };
    return res.redirect('/users');
  }
  if (safeRole === 'rider' && !phone?.trim()) {
    req.session.flash = { type: 'error', message: 'Rider ต้องระบุเบอร์โทร' };
    return res.redirect('/users');
  }

  // Non-admin cannot create 'manager' or 'admin' accounts
  if (['admin', 'manager'].includes(safeRole) && req.session.user?.role !== 'admin') {
    req.session.flash = { type: 'error', message: `เฉพาะ Admin เท่านั้นที่สามารถสร้างบัญชี ${safeRole} ได้` };
    return res.redirect('/users');
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12); // cost=12 (not 10)
    await withTransaction(async (conn) => {
      if (branchId) {
        const [[branch]] = await conn.query("SELECT id FROM branches WHERE id=? AND status='active'", [branchId]);
        if (!branch) throw new Error('ไม่พบสาขาที่เลือก');
      }
      const [result] = await conn.query(
        `INSERT INTO users (username, password_hash, name, phone, role, status, branch_id)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        [username.trim(), passwordHash, name.trim(), phone?.trim() || null, safeRole, branchId]
      );
      if (safeRole === 'rider') {
        await conn.query(
          `INSERT INTO riders (user_id, branch_id, name, phone, vehicle_type)
           VALUES (?, ?, ?, ?, 'motorcycle')`,
          [result.insertId, branchId, name.trim(), phone.trim()]
        );
      }
    });
    req.session.flash = { type: 'success', message: `เพิ่มผู้ใช้ ${username} เรียบร้อย (role: ${safeRole})` };
    res.redirect('/users');
  } catch (err) {
    console.error('[Users.create]', err);
    req.session.flash = {
      type: 'error',
      message: err.code === 'ER_DUP_ENTRY' ? `Username "${username}" มีอยู่แล้ว` : 'เกิดข้อผิดพลาด',
    };
    res.redirect('/users');
  }
}

// ─── Reset Password ───────────────────────────────────────────────────────────

export async function resetPassword(req, res) {
  const { id } = req.params;
  const { new_password } = req.body;

  if (!new_password || new_password.length < MIN_PASSWORD_LENGTH) {
    req.session.flash = {
      type: 'error',
      message: `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`,
    };
    return res.redirect('/users');
  }

  // Guard: non-admin cannot reset other admin's password
  try {
    const [[target]] = await pool.query('SELECT role FROM users WHERE id = ?', [id]);
    if (!target) {
      req.session.flash = { type: 'error', message: 'ไม่พบผู้ใช้งาน' };
      return res.redirect('/users');
    }
    if (target.role === 'admin' && req.session.user.role !== 'admin') {
      req.session.flash = { type: 'error', message: 'ไม่มีสิทธิ์รีเซ็ตรหัสผ่าน Admin' };
      return res.redirect('/users');
    }

    const passwordHash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
    req.session.flash = { type: 'success', message: 'รีเซ็ตรหัสผ่านเรียบร้อย' };
    res.redirect('/users');
  } catch (err) {
    console.error('[Users.resetPassword]', err);
    req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาด' };
    res.redirect('/users');
  }
}

// ─── Deactivate (soft "delete") ───────────────────────────────────────────────
/**
 * SECURITY NOTE: We do NOT hard-delete users.
 * Users are referenced in order_status_logs.action_by.
 * Hard-delete breaks FK integrity and destroys audit history.
 * Instead, we SET status='inactive' — they can no longer log in
 * (authController queries WHERE status='active') but audit logs are preserved.
 *
 * To fully remove a user, an operator must do it directly in the DB.
 */
export async function destroy(req, res) {
  const { id } = req.params;

  // Prevent deactivating self
  if (String(req.session.user.id) === String(id)) {
    req.session.flash = { type: 'error', message: 'ไม่สามารถปิดบัญชีตัวเองได้' };
    return res.redirect('/users');
  }

  try {
    const [[target]] = await pool.query('SELECT role, username FROM users WHERE id = ?', [id]);
    if (!target) {
      req.session.flash = { type: 'error', message: 'ไม่พบผู้ใช้งาน' };
      return res.redirect('/users');
    }

    // Prevent non-admin from deactivating admin
    if (target.role === 'admin' && req.session.user.role !== 'admin') {
      req.session.flash = { type: 'error', message: 'ไม่มีสิทธิ์ปิดบัญชี Admin' };
      return res.redirect('/users');
    }

    // Soft-deactivate
    await pool.query(
      'UPDATE users SET status = ?, deactivated_at = NOW() WHERE id = ?',
      ['inactive', id]
    );
    req.session.flash = { type: 'success', message: `ปิดบัญชี "${target.username}" แล้ว (ข้อมูล audit ยังคงอยู่)` };
    res.redirect('/users');
  } catch (err) {
    console.error('[Users.destroy]', err);
    req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาด' };
    res.redirect('/users');
  }
}
