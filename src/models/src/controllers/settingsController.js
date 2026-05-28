import pool from '../config/db.js';

export async function showRates(req, res) {
    try {
        const [rates] = await pool.query('SELECT * FROM shipping_rates ORDER BY max_weight ASC');
        res.render('settings/rates', {
            user: req.session.user,
            title: 'ตั้งค่าราคาขนส่ง (Shipping Rates)',
            rates,
            error: null,
            success: req.session.flash ? req.session.flash.message : null
        });
        delete req.session.flash;
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading rates');
    }
}

export async function createRate(req, res) {
    const { name, max_weight, max_dimension, price } = req.body;
    try {
        await pool.query(
            'INSERT INTO shipping_rates (name, max_weight, max_dimension, price) VALUES (?, ?, ?, ?)',
            [name, max_weight, max_dimension || 0, price]
        );
        req.session.flash = { type: 'success', message: 'เพิ่มเรทราคาเรียบร้อยแล้ว' };
        res.redirect('/settings/rates');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error creating rate');
    }
}

export async function deleteRate(req, res) {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM shipping_rates WHERE id = ?', [id]);
        req.session.flash = { type: 'success', message: 'ลบเรทราคาเรียบร้อยแล้ว' };
        res.redirect('/settings/rates');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error deleting rate');
    }
}

export async function calculatePrice(req, res) {
    const { weight, width, length, height } = req.query;
    const w = parseFloat(weight) || 0;
    const dimSum = (parseFloat(width) || 0) + (parseFloat(length) || 0) + (parseFloat(height) || 0);

    try {
        // 1. Find price by Weight
        const [weightRates] = await pool.query(
            'SELECT price FROM shipping_rates WHERE max_weight >= ? AND active = 1 ORDER BY price ASC LIMIT 1',
            [w]
        );

        // 2. Find price by Dimension
        let dimPrice = 0;
        if (dimSum > 0) {
            const [dimRates] = await pool.query(
                'SELECT price FROM shipping_rates WHERE max_dimension >= ? AND active = 1 ORDER BY price ASC LIMIT 1',
                [dimSum]
            );
            if (dimRates.length > 0) dimPrice = Number(dimRates[0].price);
        }

        let weightPrice = 0;
        if (weightRates.length > 0) weightPrice = Number(weightRates[0].price);

        // Take MAX
        const finalPrice = Math.max(weightPrice, dimPrice);

        res.json({
            price: finalPrice,
            found: finalPrice > 0,
            details: { weightPrice, dimPrice, dimSum }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
}
