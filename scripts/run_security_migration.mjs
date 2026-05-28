/**
 * scripts/run_security_migration.mjs
 * รัน migrate_security_001 ผ่าน Node.js (ปลอดภัย — idempotent)
 */
import pool from '../src/config/db.js';

const OK   = (msg) => console.log(`  ✅  ${msg}`);
const ERR  = (msg) => console.log(`  ❌  ${msg}`);
const INFO = (msg) => console.log(`  ℹ️   ${msg}`);

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  รัน migrate_security_001 — Users Security Update   ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // ─── 1. เพิ่มคอลัมน์ deactivated_at (ตรวจก่อน — MySQL 5.7 compat) ──
  const hasDeactivatedAt = async () => {
    const [[r]] = await pool.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='deactivated_at'`
    );
    return r.c > 0;
  };
  if (await hasDeactivatedAt()) {
    INFO('users.deactivated_at มีอยู่แล้ว — ข้าม');
  } else {
    try {
      await pool.query(
        `ALTER TABLE users ADD COLUMN deactivated_at DATETIME NULL DEFAULT NULL
          COMMENT 'Set when user is deactivated (soft-delete). NULL = active.'`
      );
      OK('เพิ่มคอลัมน์ users.deactivated_at');
    } catch (e) { ERR('deactivated_at: ' + e.message); }
  }

  // ─── 2. เพิ่ม branch_id (ตรวจก่อน — อาจมีจาก migrate_003) ──────────
  const hasBranchId = async () => {
    const [[r]] = await pool.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='branch_id'`
    );
    return r.c > 0;
  };
  if (await hasBranchId()) {
    INFO('users.branch_id มีอยู่แล้ว — ข้าม');
  } else {
    try {
      await pool.query(
        `ALTER TABLE users ADD COLUMN branch_id BIGINT UNSIGNED NULL DEFAULT NULL
          COMMENT 'FK to branches.id — branch_operator / rider เท่านั้น'`
      );
      OK('เพิ่มคอลัมน์ users.branch_id');
    } catch (e) { ERR('branch_id: ' + e.message); }
  }

  // ─── 3. Index บน branch_id (ตรวจก่อน) ──────────────────────────────
  const [[idxRow]] = await pool.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND INDEX_NAME='idx_users_branch_id'`
  );
  if (idxRow.c > 0) {
    INFO('idx_users_branch_id มีอยู่แล้ว — ข้าม');
  } else {
    try {
      await pool.query(`CREATE INDEX idx_users_branch_id ON users (branch_id)`);
      OK('สร้าง index idx_users_branch_id');
    } catch (e) { ERR('index: ' + e.message); }
  }

  // ─── 4. ตรวจ ENUM ปัจจุบัน ───────────────────────────────────────
  const [[roleCol]] = await pool.query(`
    SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'
  `);
  const [[statusCol]] = await pool.query(`
    SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'status'
  `);
  INFO('role ENUM ปัจจุบัน: ' + roleCol.COLUMN_TYPE);
  INFO('status ENUM ปัจจุบัน: ' + statusCol.COLUMN_TYPE);

  // ─── 5. MODIFY role ENUM — เพิ่ม roles ใหม่ทั้งหมด ──────────────
  const newRoleEnum = [
    'admin','staff','manager',
    'thai_warehouse','lao_warehouse',           // legacy names (backward compat)
    'dispatcher','customer_service','finance',
    'branch_operator','rider',
    'warehouse_th','warehouse_la',              // new names ใน middleware/auth.js
    'customs','driver_support',
  ].map(r => `'${r}'`).join(',');

  try {
    await pool.query(`
      ALTER TABLE users
        MODIFY COLUMN role ENUM(${newRoleEnum}) NOT NULL DEFAULT 'staff'
    `);
    OK('อัพเดท users.role ENUM — เพิ่ม warehouse_th, warehouse_la, customs, driver_support');
  } catch (e) {
    ERR('MODIFY role ENUM: ' + e.message);
  }

  // ─── 6. MODIFY status ENUM — เพิ่ม inactive ─────────────────────
  try {
    await pool.query(`
      ALTER TABLE users
        MODIFY COLUMN status ENUM('active','inactive','disabled') NOT NULL DEFAULT 'active'
    `);
    OK("อัพเดท users.status ENUM — เพิ่ม 'inactive'");
  } catch (e) {
    ERR('MODIFY status ENUM: ' + e.message);
  }

  // ─── 7. Migrate 'disabled' → 'inactive' ──────────────────────────
  try {
    const [migResult] = await pool.query(
      `UPDATE users
       SET status = 'inactive',
           deactivated_at = IFNULL(updated_at, NOW())
       WHERE status NOT IN ('active', 'inactive')`
    );
    if (migResult.affectedRows > 0) {
      OK(`แปลง legacy status: ${migResult.affectedRows} user(s) → 'inactive'`);
    } else {
      OK('ไม่มี legacy status ที่ต้องแปลง');
    }
  } catch(e) { ERR('Migrate status: ' + e.message); }

  // ─── Verify ───────────────────────────────────────────────────────
  console.log('\n── ตรวจสอบผลหลังรัน ────────────────────────────────');
  const [[finalRole]] = await pool.query(`
    SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'
  `);
  const [[finalStatus]] = await pool.query(`
    SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'status'
  `);
  const [userRows] = await pool.query(`SELECT id, username, role, status FROM users LIMIT 10`);

  INFO('role ENUM ใหม่ : ' + finalRole.COLUMN_TYPE);
  INFO('status ENUM ใหม่: ' + finalStatus.COLUMN_TYPE);
  console.log('\n  Users ในระบบ:');
  for (const u of userRows) {
    console.log(`    [${u.id}] ${u.username.padEnd(20)} role=${u.role.padEnd(20)} status=${u.status}`);
  }

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  ✅ migrate_security_001 เสร็จสิ้น                  ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
}

run()
  .catch(err => {
    console.error('\n[FATAL]', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
