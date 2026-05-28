import pool from '../config/db.js';

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
        await pool.query(
            `INSERT INTO customers (type, name, phone, email, country, province, city, address, tax_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [type, name, phone, email, country, province, city, address, tax_id]
        );
        req.session.flash = { type: 'success', message: 'เพิ่มลูกค้าสำเร็จ' };
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
            `UPDATE customers SET type=?, name=?, phone=?, email=?, country=?, province=?, city=?, address=?, tax_id=? 
       WHERE id=?`,
            [type, name, phone, email, country, province, city, address, tax_id, id]
        );
        req.session.flash = { type: 'success', message: 'แก้ไขข้อมูลสำเร็จ' };
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
