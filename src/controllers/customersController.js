import pool from '../config/db.js';
import { syncOneLegacyCustomer } from '../services/customerSyncService.js';
import { toWaPhone, isLaoPhone } from '../utils/waPhone.js';
import { sendTextMessage } from '../services/whatsappService.js';
import { findAccountByPhone } from '../services/memberLinkService.js';
import { createInviteToken } from '../services/inviteTokenService.js';

export async function list(req, res) {
    const { q } = req.query;
    let sql = `
        SELECT c.*,
               ca.id AS linked_account_id,
               ca.status AS linked_account_status,
               ca.first_name AS linked_account_first_name,
               ca.last_name AS linked_account_last_name
        FROM customers c
        LEFT JOIN customer_accounts ca ON ca.legacy_customer_id = c.id
        WHERE c.active = 1
    `;
    const params = [];

    if (q) {
        sql += ' AND (c.name LIKE ? OR c.phone LIKE ? OR c.tax_id LIKE ?)';
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    sql += ' ORDER BY c.created_at DESC LIMIT 100';

    try {
        const [customers] = await pool.query(sql, params);
        res.render('customers/index', {
            customers,
            user: req.session.user,
            title: 'จัดการลูกค้า',
            q,
            error: null
        });
    } catch (err) {
        console.error(err);
        res.render('customers/index', {
            customers: [],
            user: req.session.user,
            title: 'จัดการลูกค้า',
            q,
            error: err.message
        });
    }
}

export async function showCreate(req, res) {
    res.render('customers/form', {
        customer: {},
        user: req.session.user,
        title: 'เพิ่มลูกค้าใหม่',
        mode: 'create',
        error: null
    });
}

export async function create(req, res) {
    const { type, name, phone, email, country, province, city, address, tax_id } = req.body;
    try {
        const [insertResult] = await pool.query(
            `INSERT INTO customers (type, name, phone, phone_normalized, email, country, province, city, address, tax_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [type, name, phone, toWaPhone(phone), email, country, province, city, address, tax_id]
        );
        req.session.flash = { type: 'success', message: 'เพิ่มลูกค้าสำเร็จ' };
        // Non-blocking: sync new customer to CRM
        syncOneLegacyCustomer(insertResult.insertId).catch(err =>
            console.error('[CustomerSync] create hook error:', err.message)
        );
        res.redirect('/customers');
    } catch (err) {
        console.error(err);
        res.render('customers/form', {
            customer: req.body,
            user: req.session.user,
            title: 'เพิ่มลูกค้าใหม่',
            mode: 'create',
            error: err.message
        });
    }
}

export async function showEdit(req, res) {
    const { id } = req.params;
    try {
        const [[customer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [id]);
        if (!customer) {
            req.session.flash = { type: 'error', message: 'ไม่พบข้อมูลลูกค้า' };
            return res.redirect('/customers');
        }
        const memberLink = await resolveMemberLinkState(customer);
        res.render('customers/form', {
            customer,
            memberLink,
            user: req.session.user,
            title: 'แก้ไขลูกค้า',
            mode: 'edit',
            error: null
        });
    } catch (err) {
        console.error(err);
        res.redirect('/customers');
    }
}

export async function update(req, res) {
    const { id } = req.params;
    const { type, name, phone, email, country, province, city, address, tax_id } = req.body;
    try {
        await pool.query(
            `UPDATE customers SET type=?, name=?, phone=?, phone_normalized=?, email=?, country=?, province=?, city=?, address=?, tax_id=?
       WHERE id=?`,
            [type, name, phone, toWaPhone(phone), email, country, province, city, address, tax_id, id]
        );
        req.session.flash = { type: 'success', message: 'แก้ไขข้อมูลสำเร็จ' };
        // Non-blocking: sync updated customer to CRM
        syncOneLegacyCustomer(id).catch(err =>
            console.error('[CustomerSync] update hook error:', err.message)
        );
        res.redirect('/customers');
    } catch (err) {
        console.error(err);
        res.render('customers/form', {
            customer: { ...req.body, id },
            user: req.session.user,
            title: 'แก้ไขลูกค้า',
            mode: 'edit',
            error: err.message
        });
    }
}

export async function remove(req, res) {
    const { id } = req.params;
    try {
        // Soft delete
        await pool.query('UPDATE customers SET active = 0 WHERE id = ?', [id]);
        req.session.flash = { type: 'success', message: 'ลบลูกค้าสำเร็จ' };
    } catch (err) {
        console.error(err);
        req.session.flash = { type: 'error', message: 'ไม่สามารถลบข้อมูลได้' };
    }
    res.redirect('/customers');
}

/**
 * JSON API: customer autocomplete search
 * GET /api/customers/search?q=xxx&limit=10
 * Returns: [{ id, name, phone, address, country, type }]
 */
export async function search(req, res) {
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 10, 30);

    if (q.length < 2) {
        return res.json({ results: [] });
    }

    try {
        const term = `%${q}%`;
        const [results] = await pool.query(
            `SELECT id, name, phone, email, address, city, district, province, country, type, preferred_carrier
             FROM customers
             WHERE active = 1
               AND (name LIKE ? OR phone LIKE ? OR tax_id LIKE ? OR email LIKE ?)
             ORDER BY name ASC
             LIMIT ?`,
            [term, term, term, term, limit]
        );
        res.json({ results });
    } catch (err) {
        console.error('[CustomerSearch]', err);
        res.status(500).json({ error: 'Search failed', results: [] });
    }
}

/**
 * JSON API: phone number lookup — auto-fill customer form
 * GET /api/customers/lookup?phone=0812345678
 *
 * Returns:
 *   found=true  → { found, customer: { id, name, phone, address, ... } }
 *   found=false → { found: false }
 *
 * If ?save=true&name=...&type=... is passed with found=false,
 *   it will create the customer on-the-fly and return the new record.
 */
export async function phoneLookup(req, res) {
    const phone = (req.query.phone || '').trim().replace(/[\s\-()]/g, '');
    if (!phone || phone.length < 6) {
        return res.status(400).json({ error: 'phone required (min 6 chars)' });
    }

    try {
        // ค้นหาจากเบอร์โทร (ตรงทั้งหมด หรือ ปลาย 9 ตัว)
        const [rows] = await pool.query(
            `SELECT id, name, phone, email, address, city, district, province, country,
                    type, preferred_carrier, notes
             FROM customers
             WHERE active = 1
               AND (phone = ? OR phone LIKE ?)
             ORDER BY updated_at DESC
             LIMIT 3`,
            [phone, `%${phone.slice(-9)}`]
        );

        if (rows.length > 0) {
            // พบลูกค้า — ส่งรายชื่อที่เจอกลับ (อาจมีมากกว่า 1 เบอร์เดียวกัน)
            return res.json({ found: true, customers: rows, customer: rows[0] });
        }

        // ไม่พบ — ถ้า client ส่ง ?save=true ให้สร้างลูกค้าใหม่อัตโนมัติ
        const { save, name, type, country, province, district, city, address, preferred_carrier } = req.query;
        if (save === 'true' && name) {
            const [result] = await pool.query(
                `INSERT INTO customers
                   (type, name, phone, phone_normalized, country, province, district, city, address, preferred_carrier)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    type || 'person',
                    name,
                    phone,
                    toWaPhone(phone),
                    country || 'LA',
                    province || null,
                    district || null,
                    city || null,
                    address || null,
                    preferred_carrier || null,
                ]
            );
            const [[newCustomer]] = await pool.query(
                'SELECT * FROM customers WHERE id = ?', [result.insertId]
            );
            console.log(`[CustomerLookup] Created new customer id=${result.insertId} phone=${phone}`);
            return res.json({ found: false, created: true, customer: newCustomer });
        }

        return res.json({ found: false });
    } catch (err) {
        console.error('[CustomerLookup]', err);
        res.status(500).json({ error: 'Lookup failed' });
    }
}

/**
 * Resolve where a `customers` row stands relative to the member portal.
 * Single source of truth for both the edit-page display AND the
 * authorization checks in inviteMember/linkMember below — never duplicate
 * this decision tree.
 *
 * states:
 *   linked           — customer_accounts.legacy_customer_id = this customer.id (badge only, no action)
 *   linked_elsewhere — an account exists for this phone but is linked to a DIFFERENT customers row
 *   linkable         — an active, unlinked account exists for this phone → offer "link existing account"
 *   pending          — an account exists but is still pending_verification → offer "resend invite"
 *   invitable        — no account exists for this phone at all → offer "invite via WhatsApp"
 *   disabled         — account exists but status='disabled' (no UI writes this today; defensive only)
 *   no_phone         — customer has no usable phone number at all
 */
async function resolveMemberLinkState(customer) {
    const [[linkedAccount]] = await pool.query(
        `SELECT id, status, first_name, last_name
         FROM customer_accounts WHERE legacy_customer_id = ? LIMIT 1`,
        [customer.id]
    );
    if (linkedAccount) return { state: 'linked', account: linkedAccount };

    const phone = customer.phone_normalized || toWaPhone(customer.phone);
    if (!phone) return { state: 'no_phone', account: null };

    const account = await findAccountByPhone(phone);
    if (!account) return { state: 'invitable', account: null };
    if (account.legacy_customer_id) return { state: 'linked_elsewhere', account };
    if (account.status === 'pending_verification') return { state: 'pending', account };
    if (account.status === 'active') return { state: 'linkable', account };
    return { state: 'disabled', account };
}

/**
 * POST /customers/:id/invite-member
 * Sends (or resends, for a pending_verification account) a WhatsApp invite
 * to self-register at the member portal. Staff never sets/sees a password —
 * the customer completes their own OTP verification.
 */
export async function inviteMember(req, res) {
    const { id } = req.params;
    try {
        const [[customer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [id]);
        if (!customer) {
            req.session.flash = { type: 'error', message: 'ไม่พบข้อมูลลูกค้า' };
            return res.redirect('/customers');
        }

        const memberLink = await resolveMemberLinkState(customer);
        if (!['invitable', 'pending'].includes(memberLink.state)) {
            req.session.flash = { type: 'error', message: 'ไม่สามารถส่งคำเชิญได้ในสถานะปัจจุบัน กรุณารีเฟรชหน้าแล้วลองใหม่' };
            return res.redirect(`/customers/${id}/edit`);
        }

        const phone = customer.phone_normalized || toWaPhone(customer.phone);
        if (!phone) {
            req.session.flash = { type: 'error', message: 'ลูกค้ารายนี้ไม่มีเบอร์โทรศัพท์ที่ถูกต้องสำหรับส่งคำเชิญ' };
            return res.redirect(`/customers/${id}/edit`);
        }

        // Language: prefer the customer's own country field; fall back to the
        // phone's country code (856 = Laos) when country isn't set.
        const countryValue = String(customer.country || '').toLowerCase();
        const isLaos = countryValue
            ? ['la', 'lao', 'laos', 'ลาว'].includes(countryValue)
            : isLaoPhone(phone);

        // The link carries only an opaque token, never the raw phone — a
        // phone number in a URL sticks in browser history, access logs, and
        // Referer headers. The register page resolves it server-side.
        const inviteToken = await createInviteToken({
            phone,
            countryCode: isLaos ? '856' : '66',
            customerId: customer.id,
            createdBy: req.session.user?.id,
        });
        const registerUrl = `${req.protocol}://${res.locals.memberHost}/register?invite=${inviteToken}`;
        const message = isLaos
            ? `ສະບາຍດີ ${customer.name} 🙏\nSNG Express ມີລະບົບສະມາຊິກອອນລາຍແລ້ວ ສະໝັກ/ຢືນຢັນຕົວຕົນທີ່ລິ້ງນີ້ໄດ້ເລີຍ:\n${registerUrl}\n(ໃຊ້ເບີໂທນີ້ໃນການສະໝັກ: ${customer.phone})`
            : `สวัสดีคุณ ${customer.name} 🙏\nSNG Express เปิดระบบสมาชิกออนไลน์แล้ว สมัคร/ยืนยันตัวตนได้ที่ลิงก์นี้:\n${registerUrl}\n(ใช้เบอร์นี้ในการสมัคร: ${customer.phone})`;

        const result = await sendTextMessage(phone, message);
        req.session.flash = result?.skipped
            ? { type: 'error', message: 'เบอร์โทรศัพท์ไม่ถูกต้อง ไม่สามารถส่งคำเชิญได้' }
            : { type: 'success', message: `ส่งคำเชิญสมัครสมาชิกไปยัง WhatsApp (${customer.phone}) แล้ว` };
    } catch (err) {
        console.error('[CustomersController] inviteMember:', err);
        req.session.flash = {
            type: 'error',
            message: err.code === 'WHATSAPP_NOT_READY'
                ? 'ระบบ WhatsApp ไม่พร้อมใช้งานขณะนี้ กรุณาลองใหม่อีกครั้ง'
                : 'เกิดข้อผิดพลาดในการส่งคำเชิญ',
        };
    }
    res.redirect(`/customers/${id}/edit`);
}

/**
 * POST /customers/:id/link-member
 * One-click link for the "account already exists, just not linked yet"
 * case. Re-derives the match server-side via resolveMemberLinkState —
 * never trusts a client-supplied account id — so staff cannot point this
 * customer record at an arbitrary member account via a tampered form field.
 * The WHERE ... AND legacy_customer_id IS NULL guard on the UPDATE closes
 * the race where two staff try to link two different customers rows to the
 * same account at once.
 */
export async function linkMember(req, res) {
    const { id } = req.params;
    const staffId = req.session.user?.id;
    try {
        const [[customer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [id]);
        if (!customer) {
            req.session.flash = { type: 'error', message: 'ไม่พบข้อมูลลูกค้า' };
            return res.redirect('/customers');
        }

        const memberLink = await resolveMemberLinkState(customer);
        if (memberLink.state !== 'linkable') {
            req.session.flash = { type: 'error', message: 'ไม่พบบัญชีสมาชิกที่พร้อมเชื่อมโยงสำหรับเบอร์นี้' };
            return res.redirect(`/customers/${id}/edit`);
        }

        const conn = await pool.getConnection();
        let linked = false;
        try {
            await conn.beginTransaction();
            const [result] = await conn.query(
                `UPDATE customer_accounts SET legacy_customer_id = ? WHERE id = ? AND legacy_customer_id IS NULL`,
                [id, memberLink.account.id]
            );
            linked = result.affectedRows > 0;
            if (linked) {
                await conn.query(
                    `INSERT INTO customer_account_link_logs
                       (customer_account_id, customer_id, action, action_by)
                     VALUES (?, ?, 'linked', ?)`,
                    [memberLink.account.id, id, staffId]
                );
            }
            await conn.commit();
        } catch (txErr) {
            await conn.rollback();
            throw txErr;
        } finally {
            conn.release();
        }

        req.session.flash = linked
            ? { type: 'success', message: 'เชื่อมบัญชีสมาชิกสำเร็จ' }
            : { type: 'error', message: 'เชื่อมบัญชีไม่สำเร็จ (มีการเปลี่ยนแปลงข้อมูลระหว่างทาง) กรุณาลองใหม่' };
    } catch (err) {
        console.error('[CustomersController] linkMember:', err);
        req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาดในการเชื่อมบัญชี' };
    }
    res.redirect(`/customers/${id}/edit`);
}

/**
 * POST /customers/:id/unlink-member
 * Admin/manager only — undoing a member↔customer link is an identity-
 * relationship change, not routine customer service. Requires a reason
 * (kept in the audit log) and never touches the customer_accounts row or
 * customers row themselves — only clears the relationship.
 */
export async function unlinkMember(req, res) {
    const { id } = req.params;
    const staffId = req.session.user?.id;
    const reason = String(req.body.reason || '').trim();
    if (!reason) {
        req.session.flash = { type: 'error', message: 'กรุณาระบุเหตุผลที่ยกเลิกการเชื่อมบัญชี' };
        return res.redirect(`/customers/${id}/edit`);
    }
    try {
        const [[customer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [id]);
        if (!customer) {
            req.session.flash = { type: 'error', message: 'ไม่พบข้อมูลลูกค้า' };
            return res.redirect('/customers');
        }

        const memberLink = await resolveMemberLinkState(customer);
        if (memberLink.state !== 'linked') {
            req.session.flash = { type: 'error', message: 'ลูกค้ารายนี้ไม่ได้เชื่อมกับบัญชีสมาชิกอยู่' };
            return res.redirect(`/customers/${id}/edit`);
        }

        const conn = await pool.getConnection();
        let unlinked = false;
        try {
            await conn.beginTransaction();
            const [result] = await conn.query(
                `UPDATE customer_accounts SET legacy_customer_id = NULL WHERE id = ? AND legacy_customer_id = ?`,
                [memberLink.account.id, id]
            );
            unlinked = result.affectedRows > 0;
            if (unlinked) {
                await conn.query(
                    `INSERT INTO customer_account_link_logs
                       (customer_account_id, customer_id, action, reason, action_by)
                     VALUES (?, ?, 'unlinked', ?, ?)`,
                    [memberLink.account.id, id, reason, staffId]
                );
            }
            await conn.commit();
        } catch (txErr) {
            await conn.rollback();
            throw txErr;
        } finally {
            conn.release();
        }

        req.session.flash = unlinked
            ? { type: 'success', message: 'ยกเลิกการเชื่อมบัญชีสมาชิกแล้ว (บัญชีสมาชิกและข้อมูลลูกค้ายังอยู่ครบ)' }
            : { type: 'error', message: 'ยกเลิกการเชื่อมไม่สำเร็จ (มีการเปลี่ยนแปลงข้อมูลระหว่างทาง) กรุณาลองใหม่' };
    } catch (err) {
        console.error('[CustomersController] unlinkMember:', err);
        req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาดในการยกเลิกการเชื่อมบัญชี' };
    }
    res.redirect(`/customers/${id}/edit`);
}
