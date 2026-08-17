/**
 * src/services/otpService.js
 *
 * DB-backed WhatsApp OTP generation, rate limiting, and verification.
 */
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { sendTextMessage } from './whatsappService.js';
import { toWaPhone, isLaoPhone } from '../utils/waPhone.js';
import { findSoleCustomerMatch } from './memberLinkService.js';

const OTP_EXPIRY_MINUTES = 5;
const COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_PHONE_10MIN = 3;
const MAX_SENDS_PER_IP_1HOUR = 10;

/**
 * Generate, save, and send a 6-digit WhatsApp OTP.
 */
export async function createAndSendOtp({ accountId, phoneRaw, purpose = 'REGISTER', ip = 'unknown' }) {
  const phone = toWaPhone(phoneRaw);
  if (!phone) {
    const error = new Error('หมายเลขโทรศัพท์ไม่ถูกต้อง');
    error.code = 'INVALID_PHONE';
    throw error;
  }

  // 1. Check 60s resend cooldown for phone + purpose
  const [[cooldownRow]] = await pool.query(
    `SELECT created_at FROM customer_otp_codes
     WHERE phone = ? AND purpose = ? AND created_at > NOW() - INTERVAL ? SECOND
     ORDER BY id DESC LIMIT 1`,
    [phone, purpose, COOLDOWN_SECONDS]
  );
  if (cooldownRow) {
    const elapsed = Math.floor((Date.now() - new Date(cooldownRow.created_at).getTime()) / 1000);
    const retrySec = Math.max(1, COOLDOWN_SECONDS - elapsed);
    const error = new Error(`กรุณารอ ${retrySec} วินาทีก่อนขอรหัสใหม่`);
    error.code = 'COOLDOWN_ACTIVE';
    error.retryAfterSec = retrySec;
    throw error;
  }

  // 2. Check 10-minute cap per phone
  const [[phoneCapRow]] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM customer_otp_codes
     WHERE phone = ? AND purpose = ? AND created_at > NOW() - INTERVAL 10 MINUTE`,
    [phone, purpose]
  );
  if (Number(phoneCapRow?.cnt || 0) >= MAX_SENDS_PER_PHONE_10MIN) {
    const error = new Error('ขอรหัส OTP เกินจำนวนครั้งที่กำหนด กรุณารอ 10 นาทีแล้วลองใหม่');
    error.code = 'PHONE_RATE_LIMITED';
    throw error;
  }

  // 3. Check 1-hour cap per IP
  if (ip && ip !== 'unknown') {
    const [[ipCapRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM customer_otp_codes
       WHERE requested_ip = ? AND created_at > NOW() - INTERVAL 1 HOUR`,
      [ip]
    );
    if (Number(ipCapRow?.cnt || 0) >= MAX_SENDS_PER_IP_1HOUR) {
      const error = new Error('มีการขอรหัส OTP มากเกินไปจาก IP นี้ กรุณารอ 1 ชั่วโมงแล้วลองใหม่');
      error.code = 'IP_RATE_LIMITED';
      throw error;
    }
  }

  // 4. Generate 6-digit code and bcrypt hash
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // 5. Save to customer_otp_codes
  await pool.query(
    `INSERT INTO customer_otp_codes
       (account_id, phone, purpose, code_hash, expires_at, requested_ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [accountId, phone, purpose, codeHash, expiresAt, ip]
  );

  // 6. Send via WhatsApp — same country-code-driven language choice as the
  // rest of the member portal (no `customer.country` available here, only
  // the phone, so this is always the phone-prefix fallback).
  const msgBody = isLaoPhone(phone)
    ? (purpose === 'RESET_PASSWORD'
        ? `🔐 *SNG EXPRESS*\nລະຫັດຣີເຊັດລະຫັດຜ່ານ (OTP) ຂອງທ່ານແມ່ນ: *${code}*\n(ລະຫັດມີອາຍຸ 5 ນາທີ ແລະ ຫ້າມບອກລະຫັດນີ້ໃຫ້ຜູ້ອື່ນ)`
        : `🔐 *SNG EXPRESS*\nລະຫັດຢືນຢັນ (OTP) ສະໝັກສະມາຊິກຂອງທ່ານແມ່ນ: *${code}*\n(ລະຫັດມີອາຍຸ 5 ນາທີ ແລະ ຫ້າມບອກລະຫັດນີ້ໃຫ້ຜູ້ອື່ນ)`)
    : (purpose === 'RESET_PASSWORD'
        ? `🔐 *SNG EXPRESS*\nรหัสรีเซ็ตรหัสผ่าน (OTP) ของคุณคือ: *${code}*\n(รหัสมีอายุ 5 นาที และห้ามแจ้งรหัสนี้แก่ผู้อื่น)`
        : `🔐 *SNG EXPRESS*\nรหัสยืนยัน (OTP) สมัครสมาชิกของคุณคือ: *${code}*\n(รหัสมีอายุ 5 นาที และห้ามแจ้งรหัสนี้แก่ผู้อื่น)`);

  try {
    await sendTextMessage(phone, msgBody);
  } catch (err) {
    console.error('[OTP] WhatsApp Send Failed:', err);
    const error = new Error('ระบบส่ง WhatsApp ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง');
    error.code = err.code || 'WHATSAPP_SEND_FAILED';
    throw error;
  }

  return { success: true, phone, expiresAt };
}

/**
 * Verify a submitted OTP code.
 */
export async function verifyOtp({ accountId, _phoneRaw, purpose = 'REGISTER', code }) {
  const cleanCode = String(code || '').trim();

  if (!cleanCode || cleanCode.length !== 6) {
    return { success: false, message: 'กรุณากรอกรหัส OTP 6 หลัก' };
  }

  const [[otpRecord]] = await pool.query(
    `SELECT id, code_hash, attempts, max_attempts, expires_at
     FROM customer_otp_codes
     WHERE account_id = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [accountId, purpose]
  );

  if (!otpRecord) {
    return { success: false, message: 'รหัส OTP หมดอายุหรือไม่มีอยู่ กรุณากดขอรหัสใหม่' };
  }

  if (otpRecord.attempts >= otpRecord.max_attempts) {
    return { success: false, message: 'ป้อนรหัสผิดเกินจำนวนครั้งที่กำหนด กรุณากดขอรหัสใหม่' };
  }

  const matches = await bcrypt.compare(cleanCode, otpRecord.code_hash);

  if (!matches) {
    await pool.query(
      `UPDATE customer_otp_codes SET attempts = attempts + 1 WHERE id = ?`,
      [otpRecord.id]
    );
    const remaining = otpRecord.max_attempts - (otpRecord.attempts + 1);
    return {
      success: false,
      message: remaining > 0
        ? `รหัส OTP ไม่ถูกต้อง (เหลือโอกาสลองอีก ${remaining} ครั้ง)`
        : 'ป้อนรหัสผิดเกินจำนวนครั้งที่กำหนด กรุณากดขอรหัสใหม่',
    };
  }

  // Success: Mark code consumed & activate account if REGISTER
  await pool.query(
    `UPDATE customer_otp_codes SET consumed_at = NOW() WHERE id = ?`,
    [otpRecord.id]
  );

  if (purpose === 'REGISTER') {
    await pool.query(
      `UPDATE customer_accounts
       SET status = 'active', phone_verified_at = NOW()
       WHERE id = ?`,
      [accountId]
    );

    // Best-effort legacy linkage (PUBLIC_PORTAL_PLAN.md §4.2, never actually
    // wired up before this). Only auto-link when exactly ONE customers row
    // shares this phone — ambiguous (0 or 2+ matches) is left unlinked, and
    // a failure here must never block the registration itself.
    try {
      const [[account]] = await pool.query(
        `SELECT phone, legacy_customer_id FROM customer_accounts WHERE id = ?`,
        [accountId]
      );
      if (account && !account.legacy_customer_id) {
        const legacyId = await findSoleCustomerMatch(account.phone);
        if (legacyId) {
          await pool.query(
            `UPDATE customer_accounts SET legacy_customer_id = ? WHERE id = ? AND legacy_customer_id IS NULL`,
            [legacyId, accountId]
          );
        }
      }
    } catch (linkErr) {
      console.error('[OTP] legacy_customer_id auto-link failed:', linkErr.message);
    }
  }

  return { success: true };
}
