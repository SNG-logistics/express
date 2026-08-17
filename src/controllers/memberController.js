/**
 * src/controllers/memberController.js
 *
 * Member accounts controller for registration, WhatsApp OTP verification,
 * login/logout, profile management, and customer order history.
 */
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { toWaPhone } from '../utils/waPhone.js';
import { createAndSendOtp, verifyOtp } from '../services/otpService.js';
import { regenerateCustomerSession, recordMemberLoginAttempt } from '../middleware/customerAuth.js';

// Constant-time login even when the phone isn't registered (resist enumeration).
const DUMMY_PASSWORD_HASH = '$2b$10$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'SNG-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * GET /member — bare root, mainly hit via the member.<host> subdomain.
 */
export function memberRoot(req, res) {
  if (req.session?.customer) return res.redirect('/member/profile');
  return res.redirect('/member/login');
}

/**
 * GET /member/register
 */
export function showRegister(req, res) {
  if (req.session?.customer) return res.redirect('/member/profile');
  res.render('customer/member/register', {
    layout: 'customer/layout',
    title: `${res.locals.t('portal.register')} | SNG Express`,
    values: {},
    error: null,
  });
}

/**
 * POST /member/register
 */
export async function processRegister(req, res) {
  const { phone: rawPhone, password, confirm_password, first_name, last_name, gender, referral_code } = req.body;
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const values = { phone: rawPhone, first_name, last_name, gender, referral_code };

  if (!rawPhone || !password || !first_name) {
    return res.render('customer/member/register', {
      layout: 'customer/layout',
      title: `${res.locals.t('portal.register')} | SNG Express`,
      values,
      error: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน (เบอร์โทร, ชื่อ, รหัสผ่าน)',
    });
  }

  if (password.length < 6) {
    return res.render('customer/member/register', {
      layout: 'customer/layout',
      title: `${res.locals.t('portal.register')} | SNG Express`,
      values,
      error: 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร',
    });
  }

  if (password !== confirm_password) {
    return res.render('customer/member/register', {
      layout: 'customer/layout',
      title: `${res.locals.t('portal.register')} | SNG Express`,
      values,
      error: 'รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน',
    });
  }

  const phone = toWaPhone(rawPhone);
  if (!phone) {
    return res.render('customer/member/register', {
      layout: 'customer/layout',
      title: `${res.locals.t('portal.register')} | SNG Express`,
      values,
      error: 'เบอร์โทรศัพท์ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
    });
  }

  try {
    // Check existing account
    const [[existing]] = await pool.query(
      `SELECT id, status FROM customer_accounts WHERE phone = ?`,
      [phone]
    );

    if (existing && existing.status === 'active') {
      return res.render('customer/member/register', {
        layout: 'customer/layout',
        title: `${res.locals.t('portal.register')} | SNG Express`,
        values,
        error: 'เบอร์โทรศัพท์นี้ลงทะเบียนแล้ว กรุณาเข้าสู่ระบบ',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let accountId;

    if (existing && existing.status === 'pending_verification') {
      // Update pending registration
      accountId = existing.id;
      await pool.query(
        `UPDATE customer_accounts
         SET password_hash = ?, first_name = ?, last_name = ?, gender = ?, phone_display = ?
         WHERE id = ?`,
        [passwordHash, first_name.trim(), (last_name || '').trim(), gender || null, rawPhone.trim(), accountId]
      );
    } else {
      // Check referral code if provided
      let referrerId = null;
      if (referral_code && referral_code.trim()) {
        const [[referrer]] = await pool.query(
          `SELECT id FROM customer_accounts WHERE referral_code = ? AND status = 'active'`,
          [referral_code.trim().toUpperCase()]
        );
        if (referrer) referrerId = referrer.id;
      }

      // Generate unique referral code for new member
      let myRefCode = generateReferralCode();
      for (let i = 0; i < 5; i++) {
        const [[dup]] = await pool.query(`SELECT id FROM customer_accounts WHERE referral_code = ?`, [myRefCode]);
        if (!dup) break;
        myRefCode = generateReferralCode();
      }

      const [resIns] = await pool.query(
        `INSERT INTO customer_accounts
           (phone, phone_display, password_hash, first_name, last_name, gender, referral_code, referred_by_account_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification')`,
        [phone, rawPhone.trim(), passwordHash, first_name.trim(), (last_name || '').trim(), gender || null, myRefCode, referrerId]
      );
      accountId = resIns.insertId;
    }

    // Send OTP via WhatsApp
    await createAndSendOtp({ accountId, phoneRaw: phone, purpose: 'REGISTER', ip });

    req.session.pendingVerification = {
      accountId,
      phone,
      phoneDisplay: rawPhone.trim(),
      purpose: 'REGISTER',
    };

    res.redirect('/member/verify');
  } catch (err) {
    console.error('[Member Register]', err);
    res.render('customer/member/register', {
      layout: 'customer/layout',
      title: `${res.locals.t('portal.register')} | SNG Express`,
      values,
      error: err.message || 'เกิดข้อผิดพลาดในการลงทะเบียน กรุณาลองใหม่อีกครั้ง',
    });
  }
}

/**
 * GET /member/verify
 */
export function showVerify(req, res) {
  const pending = req.session.pendingVerification;
  if (!pending) return res.redirect('/member/register');

  res.render('customer/member/verify', {
    layout: 'customer/layout',
    title: `ยืนยันรหัส OTP | SNG Express`,
    pending,
    error: null,
    success: null,
  });
}

/**
 * POST /member/verify
 */
export async function processVerify(req, res) {
  const pending = req.session.pendingVerification;
  if (!pending) return res.redirect('/member/register');

  const { code } = req.body;

  try {
    const result = await verifyOtp({
      accountId: pending.accountId,
      phoneRaw: pending.phone,
      purpose: pending.purpose,
      code,
    });

    if (!result.success) {
      return res.render('customer/member/verify', {
        layout: 'customer/layout',
        title: `ยืนยันรหัส OTP | SNG Express`,
        pending,
        error: result.message,
        success: null,
      });
    }

    if (pending.purpose === 'RESET_PASSWORD') {
      req.session.resetVerified = { accountId: pending.accountId, phone: pending.phone };
      delete req.session.pendingVerification;
      return res.redirect('/member/reset-password');
    }

    // Purpose = REGISTER: Log customer in
    const [[account]] = await pool.query(
      `SELECT id, phone, phone_display, first_name, last_name, gender, referral_code
       FROM customer_accounts WHERE id = ?`,
      [pending.accountId]
    );

    delete req.session.pendingVerification;

    await pool.query(`UPDATE customer_accounts SET last_login_at = NOW() WHERE id = ?`, [account.id]);

    regenerateCustomerSession(req, account, () => {
      req.session.flash = { type: 'success', message: 'สมัครสมาชิกและยืนยันตัวตนสำเร็จ!' };
      res.redirect('/member/profile');
    });
  } catch (err) {
    console.error('[Member Verify]', err);
    res.render('customer/member/verify', {
      layout: 'customer/layout',
      title: `ยืนยันรหัส OTP | SNG Express`,
      pending,
      error: 'เกิดข้อผิดพลาดในการตรวจสอบรหัส OTP กรุณาลองใหม่',
      success: null,
    });
  }
}

/**
 * POST /member/verify/resend
 */
export async function resendOtp(req, res) {
  const pending = req.session.pendingVerification;
  if (!pending) return res.redirect('/member/register');

  const ip = req.ip || req.socket?.remoteAddress || 'unknown';

  try {
    await createAndSendOtp({
      accountId: pending.accountId,
      phoneRaw: pending.phone,
      purpose: pending.purpose,
      ip,
    });

    res.render('customer/member/verify', {
      layout: 'customer/layout',
      title: `ยืนยันรหัส OTP | SNG Express`,
      pending,
      error: null,
      success: 'ส่งรหัส OTP ใหม่ไปยัง WhatsApp เรียบร้อยแล้ว',
    });
  } catch (err) {
    res.render('customer/member/verify', {
      layout: 'customer/layout',
      title: `ยืนยันรหัส OTP | SNG Express`,
      pending,
      error: err.message,
      success: null,
    });
  }
}

/**
 * GET /member/login
 */
export function showLogin(req, res) {
  if (req.session?.customer) return res.redirect('/member/profile');
  res.render('customer/member/login', {
    layout: 'customer/layout',
    title: `${res.locals.t('portal.login')} | SNG Express`,
    values: { country_code: '66' },
    error: null,
  });
}

/**
 * POST /member/login
 */
export async function processLogin(req, res) {
  const { phone: rawPhone, password, country_code: countryCode } = req.body;
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const values = {
    phone: rawPhone,
    country_code: countryCode === '856' ? '856' : '66',
  };

  if (!rawPhone || !password) {
    return res.render('customer/member/login', {
      layout: 'customer/layout',
      title: `${res.locals.t('portal.login')} | SNG Express`,
      values,
      error: 'กรุณากรอกเบอร์โทรศัพท์และรหัสผ่าน',
    });
  }

  const phone = toWaPhone(rawPhone, countryCode ?? '');
  if (!phone) {
    return res.render('customer/member/login', {
      layout: 'customer/layout',
      title: `${res.locals.t('portal.login')} | SNG Express`,
      values,
      error: 'เบอร์โทรศัพท์ไม่ถูกต้อง',
    });
  }

  try {
    const [[account]] = await pool.query(
      `SELECT id, phone, phone_display, password_hash, first_name, last_name, gender, status, referral_code
       FROM customer_accounts WHERE phone = ?`,
      [phone]
    );

    // Always run bcrypt.compare, even with no matching account, so response
    // timing doesn't reveal whether a phone number is registered.
    const matches = account
      ? await bcrypt.compare(password, account.password_hash)
      : await bcrypt.compare(password, DUMMY_PASSWORD_HASH).then(() => false);

    if (!account || account.status === 'disabled' || !matches) {
      recordMemberLoginAttempt(ip, false);
      return res.render('customer/member/login', {
        layout: 'customer/layout',
        title: `${res.locals.t('portal.login')} | SNG Express`,
        values,
        error: 'เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง',
      });
    }

    if (account.status === 'pending_verification') {
      recordMemberLoginAttempt(ip, true);
      await createAndSendOtp({ accountId: account.id, phoneRaw: phone, purpose: 'REGISTER', ip });
      req.session.pendingVerification = {
        accountId: account.id,
        phone,
        phoneDisplay: rawPhone,
        purpose: 'REGISTER',
      };
      return res.redirect('/member/verify');
    }

    recordMemberLoginAttempt(ip, true);

    // Success -> Log customer in
    await pool.query(`UPDATE customer_accounts SET last_login_at = NOW() WHERE id = ?`, [account.id]);

    const customerPayload = {
      id: account.id,
      phone: account.phone,
      phone_display: account.phone_display || rawPhone,
      first_name: account.first_name,
      last_name: account.last_name,
      gender: account.gender,
      referral_code: account.referral_code,
    };

    const returnTo = req.session.returnTo || '/member/profile';
    regenerateCustomerSession(req, customerPayload, () => {
      res.redirect(returnTo);
    });
  } catch (err) {
    console.error('[Member Login]', err);
    res.render('customer/member/login', {
      layout: 'customer/layout',
      title: `${res.locals.t('portal.login')} | SNG Express`,
      values,
      error: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ กรุณาลองใหม่',
    });
  }
}

/**
 * GET /member/logout
 */
export function logout(req, res) {
  if (req.session) {
    delete req.session.customer;
  }
  res.redirect('/');
}

/**
 * GET /member/forgot-password
 */
export function showForgotPassword(req, res) {
  res.render('customer/member/forgot-password', {
    layout: 'customer/layout',
    title: 'ลืมรหัสผ่าน | SNG Express',
    error: null,
  });
}

/**
 * POST /member/forgot-password
 */
export async function processForgotPassword(req, res) {
  const { phone: rawPhone } = req.body;
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';

  const phone = toWaPhone(rawPhone);
  if (!phone) {
    return res.render('customer/member/forgot-password', {
      layout: 'customer/layout',
      title: 'ลืมรหัสผ่าน | SNG Express',
      error: 'เบอร์โทรศัพท์ไม่ถูกต้อง',
    });
  }

  try {
    const [[account]] = await pool.query(
      `SELECT id, status FROM customer_accounts WHERE phone = ?`,
      [phone]
    );

    if (!account || account.status !== 'active') {
      return res.render('customer/member/forgot-password', {
        layout: 'customer/layout',
        title: 'ลืมรหัสผ่าน | SNG Express',
        error: 'ไม่พบบัญชีสมาชิกที่เปิดใช้งานด้วยเบอร์โทรศัพท์นี้',
      });
    }

    await createAndSendOtp({ accountId: account.id, phoneRaw: phone, purpose: 'RESET_PASSWORD', ip });

    req.session.pendingVerification = {
      accountId: account.id,
      phone,
      phoneDisplay: rawPhone,
      purpose: 'RESET_PASSWORD',
    };

    res.redirect('/member/verify');
  } catch (err) {
    res.render('customer/member/forgot-password', {
      layout: 'customer/layout',
      title: 'ลืมรหัสผ่าน | SNG Express',
      error: err.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่',
    });
  }
}

/**
 * GET /member/reset-password
 */
export function showResetPassword(req, res) {
  if (!req.session?.resetVerified) return res.redirect('/member/login');
  res.render('customer/member/reset-password', {
    layout: 'customer/layout',
    title: 'ตั้งรหัสผ่านใหม่ | SNG Express',
    error: null,
  });
}

/**
 * POST /member/reset-password
 */
export async function processResetPassword(req, res) {
  const verified = req.session?.resetVerified;
  if (!verified) return res.redirect('/member/login');

  const { password, confirm_password } = req.body;

  if (!password || password.length < 6) {
    return res.render('customer/member/reset-password', {
      layout: 'customer/layout',
      title: 'ตั้งรหัสผ่านใหม่ | SNG Express',
      error: 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร',
    });
  }

  if (password !== confirm_password) {
    return res.render('customer/member/reset-password', {
      layout: 'customer/layout',
      title: 'ตั้งรหัสผ่านใหม่ | SNG Express',
      error: 'รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน',
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE customer_accounts SET password_hash = ? WHERE id = ?`,
      [passwordHash, verified.accountId]
    );

    delete req.session.resetVerified;

    req.session.flash = { type: 'success', message: 'ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบ' };
    res.redirect('/member/login');
  } catch (err) {
    console.error('[Member Reset Password]', err);
    res.render('customer/member/reset-password', {
      layout: 'customer/layout',
      title: 'ตั้งรหัสผ่านใหม่ | SNG Express',
      error: 'เกิดข้อผิดพลาดในการตั้งรหัสผ่านใหม่',
    });
  }
}

/**
 * GET /member/profile
 */
export async function profile(req, res) {
  const customer = req.session.customer;
  try {
    const [[account]] = await pool.query(
      `SELECT id, phone, phone_display, first_name, last_name, gender, referral_code, created_at
       FROM customer_accounts WHERE id = ?`,
      [customer.id]
    );

    res.render('customer/member/profile', {
      layout: 'customer/layout',
      title: `${res.locals.t('portal.account')} | SNG Express`,
      account: account || customer,
    });
  } catch (err) {
    console.error('[Member Profile]', err);
    res.render('customer/member/profile', {
      layout: 'customer/layout',
      title: `${res.locals.t('portal.account')} | SNG Express`,
      account: customer,
    });
  }
}

/**
 * GET /member/orders
 */
export async function myOrders(req, res) {
  const customer = req.session.customer;
  const phone = customer.phone;

  try {
    const [orders] = await pool.query(
      `SELECT o.id, o.job_no, o.direction, o.status, o.declared_weight, o.cod_amount, o.created_at,
              s.name AS sender_name, r.name AS receiver_name, r.city AS receiver_city
       FROM orders o
       LEFT JOIN customers s ON s.id = o.sender_id
       LEFT JOIN customers r ON r.id = o.receiver_id
       WHERE s.phone_normalized = ? OR r.phone_normalized = ? OR s.phone = ? OR r.phone = ?
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [phone, phone, phone, phone]
    );

    res.render('customer/member/orders', {
      layout: 'customer/layout',
      title: `รายการพัสดุของฉัน | SNG Express`,
      orders,
    });
  } catch (err) {
    console.error('[Member Orders]', err);
    res.render('customer/member/orders', {
      layout: 'customer/layout',
      title: `รายการพัสดุของฉัน | SNG Express`,
      orders: [],
    });
  }
}

/**
 * GET /member/account
 */
export async function accountEdit(req, res) {
  const customer = req.session.customer;
  const [[account]] = await pool.query(
    `SELECT id, phone, phone_display, first_name, last_name, gender FROM customer_accounts WHERE id = ?`,
    [customer.id]
  );
  res.render('customer/member/account', {
    layout: 'customer/layout',
    title: 'แก้ไขข้อมูลส่วนตัว | SNG Express',
    account: account || customer,
    error: null,
    success: null,
  });
}

/**
 * POST /member/account
 */
export async function processAccountEdit(req, res) {
  const customer = req.session.customer;
  const { first_name, last_name, gender } = req.body;

  if (!first_name || !first_name.trim()) {
    return res.render('customer/member/account', {
      layout: 'customer/layout',
      title: 'แก้ไขข้อมูลส่วนตัว | SNG Express',
      account: { ...customer, first_name, last_name, gender },
      error: 'กรุณากรอกชื่อ',
      success: null,
    });
  }

  try {
    await pool.query(
      `UPDATE customer_accounts SET first_name = ?, last_name = ?, gender = ? WHERE id = ?`,
      [first_name.trim(), (last_name || '').trim(), gender || null, customer.id]
    );

    req.session.customer.first_name = first_name.trim();
    req.session.customer.last_name = (last_name || '').trim();
    req.session.customer.gender = gender || null;

    res.render('customer/member/account', {
      layout: 'customer/layout',
      title: 'แก้ไขข้อมูลส่วนตัว | SNG Express',
      account: req.session.customer,
      error: null,
      success: 'บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว',
    });
  } catch (err) {
    console.error('[Member Account Edit]', err);
    res.render('customer/member/account', {
      layout: 'customer/layout',
      title: 'แก้ไขข้อมูลส่วนตัว | SNG Express',
      account: { ...customer, first_name, last_name, gender },
      error: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล',
      success: null,
    });
  }
}

/**
 * GET /member/quote-request
 * Public intake form for "เช็คราคาสินค้าออนไลน์จากไทย".
 * Requires a logged-in (OTP-verified) member.
 */
export function showQuoteRequest(req, res) {
  const values = {
    product_url: typeof req.query.url === 'string' ? req.query.url.slice(0, 1000) : '',
    product_name: '',
    desired_qty: 1,
    note: '',
  };
  res.render('customer/member/quote-request', {
    layout: 'customer/layout',
    title: 'เช็คราคาสินค้าออนไลน์ | SNG Express',
    values,
    error: null,
  });
}

/**
 * POST /member/quote-request
 * Saves a customer intent row (status='new'). Pricing stays staff-side.
 */
export async function processQuoteRequest(req, res) {
  const customer = req.session.customer;
  const { product_url, product_name, desired_qty, note } = req.body;

  const values = {
    product_url: (product_url || '').trim().slice(0, 1000),
    product_name: (product_name || '').trim().slice(0, 500),
    desired_qty: Math.max(1, parseInt(desired_qty, 10) || 1),
    note: (note || '').trim().slice(0, 1000),
  };

  if (!values.product_name) {
    return res.render('customer/member/quote-request', {
      layout: 'customer/layout',
      title: 'เช็คราคาสินค้าออนไลน์ | SNG Express',
      values,
      error: 'กรุณากรอกชื่อสินค้าหรือลิงก์สินค้า',
    });
  }

  try {
    await pool.query(
      `INSERT INTO product_quote_requests
         (customer_account_id, product_url, product_name, desired_qty, note, status)
       VALUES (?, ?, ?, ?, ?, 'new')`,
      [customer.id, values.product_url || null, values.product_name, values.desired_qty, values.note || null]
    );

    req.session.flash = {
      type: 'success',
      message: 'ส่งคำขอเช็คราคาเรียบร้อย เจ้าหน้าที่จะติดต่อกลับทาง WhatsApp',
    };
    res.redirect('/member/quote-requests');
  } catch (err) {
    console.error('[Member Quote Request]', err);
    res.render('customer/member/quote-request', {
      layout: 'customer/layout',
      title: 'เช็คราคาสินค้าออนไลน์ | SNG Express',
      values,
      error: 'เกิดข้อผิดพลาดในการส่งคำขอ กรุณาลองใหม่อีกครั้ง',
    });
  }
}

/**
 * GET /member/quote-requests
 * The member's own request history, with quotation reference when converted.
 */
export async function myQuoteRequests(req, res) {
  const customer = req.session.customer;
  try {
    const [requests] = await pool.query(
      `SELECT pqr.id, pqr.product_url, pqr.product_name, pqr.desired_qty, pqr.note,
              pqr.status, pqr.linked_quotation_id, pqr.created_at,
              pq.quote_no
       FROM product_quote_requests pqr
       LEFT JOIN partner_quotations pq ON pq.id = pqr.linked_quotation_id
       WHERE pqr.customer_account_id = ?
       ORDER BY pqr.created_at DESC
       LIMIT 100`,
      [customer.id]
    );

    res.render('customer/member/quote-requests', {
      layout: 'customer/layout',
      title: 'คำขอเช็คราคาของฉัน | SNG Express',
      requests,
    });
  } catch (err) {
    console.error('[Member Quote Requests]', err);
    res.render('customer/member/quote-requests', {
      layout: 'customer/layout',
      title: 'คำขอเช็คราคาของฉัน | SNG Express',
      requests: [],
    });
  }
}
