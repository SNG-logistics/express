import pool from '../config/db.js';

export async function addPayment(req, res) {
    const { id } = req.params; // order_id
    const { type, amount, note } = req.body;

    try {
        const numAmount = Number(amount);
        if (!numAmount || numAmount <= 0) {
            req.session.flash = { type: 'error', message: 'Invalid amount' };
            return res.redirect(`/orders/${id}`);
        }

        await pool.query(
            `INSERT INTO payments (order_id, type, method, amount, status, ref_no)
       VALUES (?, ?, 'cash', ?, 'PAID', ?)`
            , [id, type || 'fee', numAmount, note || '']
        );

        req.session.flash = { type: 'success', message: 'Expense added successfully' };
        res.redirect(`/orders/${id}`);
    } catch (err) {
        console.error(err);
        req.session.flash = { type: 'error', message: 'Failed to add expense: ' + err.message };
        res.redirect(`/orders/${id}`);
    }
}

export async function deletePayment(req, res) {
    const { id, paymentId } = req.params;
    try {
        await pool.query('DELETE FROM payments WHERE id = ? AND order_id = ?', [paymentId, id]);
        req.session.flash = { type: 'success', message: 'Expense removed' };
        res.redirect(`/orders/${id}`);
    } catch (err) {
        console.error(err);
        req.session.flash = { type: 'error', message: 'Failed to remove expense: ' + err.message };
        res.redirect(`/orders/${id}`);
    }
}
