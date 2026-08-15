import pool from '../config/db.js';
import { syncOneLegacyCustomer } from '../services/customerSyncService.js';
import { toWaPhone } from '../utils/waPhone.js';

export async function list(req, res) {
    const { q } = req.query;
    let sql = 'SELECT * FROM customers WHERE active = 1';
    const params = [];

    if (q) {
        sql += ' AND (name LIKE ? OR phone LIKE ? OR tax_id LIKE ?)';
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    sql += ' ORDER BY created_at DESC LIMIT 100';

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
        res.render('customers/form', {
            customer,
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
