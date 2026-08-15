import pool from '../config/db.js';

// ─── Helper: format date as YYYYMMDD ─────────────────────────────────────────
function dateStr(d = new Date()) {
    return d.getFullYear().toString()
        + String(d.getMonth() + 1).padStart(2, '0')
        + String(d.getDate()).padStart(2, '0');
}


async function genQuoteNo() {
    const d = dateStr();

    const [[row]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM partner_quotations WHERE DATE(created_at) = CURDATE()`
    );
    const seq = String((row.cnt || 0) + 1).padStart(4, '0');
    return `PQ-${d}-${seq}`;
}

// ─── Helper: calculate totals ─────────────────────────────────────────────────
function calcQuote({ product_price_thb, shipping_th_thb, exchange_rate, fx_spread_pct, sng_shipping_lak, service_fee_lak }) {
    const productThb  = parseFloat(product_price_thb) || 0;
    const shippingThb = parseFloat(shipping_th_thb)   || 0;
    const rate        = parseFloat(exchange_rate)      || 1;
    const spread      = parseFloat(fx_spread_pct)      || 0;
    const sngShip     = parseFloat(sng_shipping_lak)   || 0;
    const serviceFee  = parseFloat(service_fee_lak)    || 0;

    const subtotalThb      = productThb + shippingThb;
    const effectiveRate    = rate * (1 + spread / 100);
    const productLak       = Math.ceil(subtotalThb * effectiveRate);
    const totalLak         = productLak + sngShip + serviceFee;

    return { subtotalThb, productLak, totalLak };
}

// ─── LIST ─────────────────────────────────────────────────────────────────────
export async function list(req, res) {
    try {
        const { status, q } = req.query;
        let sql = `
            SELECT pq.*, b.name AS branch_name, u.username AS creator
            FROM partner_quotations pq
            LEFT JOIN branches b ON b.id = pq.branch_id
            LEFT JOIN users u ON u.id = pq.created_by
            WHERE 1=1
        `;
        const params = [];
        if (status) { sql += ' AND pq.status = ?'; params.push(status); }
        if (q) { sql += ' AND (pq.product_name LIKE ? OR pq.quote_no LIKE ? OR pq.customer_name LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
        sql += ' ORDER BY pq.created_at DESC LIMIT 200';

        const [quotes] = await pool.query(sql, params);
        res.render('partner/quotes/list', {
            user: req.session.user, title: 'ใบเสนอราคา Partner',
            quotes, status: status || '', q: q || ''
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
}

// ─── NEW FORM ─────────────────────────────────────────────────────────────────
export async function newForm(req, res) {
    try {
        const [branches] = await pool.query(
            "SELECT id, name FROM branches WHERE status = 'active' ORDER BY name"
        );
        // latest FX rate
        const [[fx]] = await pool.query(
            "SELECT rate FROM exchange_rates WHERE pair = 'THB_LAK' ORDER BY created_at DESC LIMIT 1"
        );
        const [shippingRates] = await pool.query(
            'SELECT * FROM shipping_rates WHERE active = 1 ORDER BY max_weight ASC'
        );
        res.render('partner/quotes/new', {
            user: req.session.user,
            title: 'สร้างใบเสนอราคา',
            branches,
            fx_rate: fx?.rate || 200,
            shippingRates,
            request: null,
            error: null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
}

// ─── CREATE ───────────────────────────────────────────────────────────────────
export async function create(req, res) {
    const {
        branch_id, product_url, product_name, product_price_thb,
        shipping_th_thb, weight_kg, exchange_rate, fx_spread_pct,
        sng_shipping_lak, service_fee_lak,
        customer_name, customer_phone, customer_address, note, status,
        quote_request_id
    } = req.body;

    try {
        const { subtotalThb, totalLak } = calcQuote({
            product_price_thb, shipping_th_thb, exchange_rate,
            fx_spread_pct, sng_shipping_lak, service_fee_lak
        });
        const quote_no = await genQuoteNo();

        await pool.query(
            `INSERT INTO partner_quotations
             (branch_id, created_by, quote_no, product_url, product_name,
              product_price_thb, shipping_th_thb, weight_kg,
              exchange_rate, fx_spread_pct, sng_shipping_lak, service_fee_lak,
              subtotal_thb, total_lak,
              customer_name, customer_phone, customer_address, note, status)
             VALUES (?,?,?,?,?, ?,?,?, ?,?,?,?, ?,?, ?,?,?,?,?)`,
            [
                branch_id || null, req.session.user?.id, quote_no,
                product_url || null, product_name,
                parseFloat(product_price_thb) || 0,
                parseFloat(shipping_th_thb) || 0,
                parseFloat(weight_kg) || 0,
                parseFloat(exchange_rate) || 200,
                parseFloat(fx_spread_pct) || 0,
                parseFloat(sng_shipping_lak) || 0,
                parseFloat(service_fee_lak) || 0,
                subtotalThb, totalLak,
                customer_name || null, customer_phone || null,
                customer_address || null, note || null,
                status || 'draft'
            ]
        );
        const [[inserted]] = await pool.query(
            'SELECT id FROM partner_quotations WHERE quote_no = ? LIMIT 1', [quote_no]
        );

        // If created from a public quote request, link the quotation back
        // and flip the request to 'quoted' so the member sees it as done.
        const requestId = Number(quote_request_id) || null;
        if (requestId) {
            await pool.query(
                `UPDATE product_quote_requests
                 SET linked_quotation_id = ?, status = 'quoted'
                 WHERE id = ?`,
                [inserted.id, requestId]
            );
        }

        res.redirect(`/partner/quotes/${inserted.id}`);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
}

// ─── DETAIL ───────────────────────────────────────────────────────────────────
export async function detail(req, res) {
    const { id } = req.params;
    try {
        const [[quote]] = await pool.query(
            `SELECT pq.*, b.name AS branch_name, u.username AS creator
             FROM partner_quotations pq
             LEFT JOIN branches b ON b.id = pq.branch_id
             LEFT JOIN users u ON u.id = pq.created_by
             WHERE pq.id = ?`, [id]
        );
        if (!quote) return res.status(404).send('ไม่พบใบเสนอราคา');

        res.render('partner/quotes/detail', {
            user: req.session.user,
            title: `ใบเสนอราคา ${quote.quote_no}`,
            quote
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
}

// ─── PRINT QUOTE ─────────────────────────────────────────────────────────────
export async function printQuote(req, res) {
    const { id } = req.params;
    try {
        const [[quote]] = await pool.query(
            `SELECT pq.*, b.name AS branch_name, u.username AS creator
             FROM partner_quotations pq
             LEFT JOIN branches b ON b.id = pq.branch_id
             LEFT JOIN users u ON u.id = pq.created_by
             WHERE pq.id = ?`, [id]
        );
        if (!quote) return res.status(404).send('ไม่พบใบเสนอราคา');

        const [settingRows] = await pool.query('SELECT setting_key, setting_value FROM company_settings');
        const company = Object.fromEntries(settingRows.map(r => [r.setting_key, r.setting_value]));

        res.render('partner/quotes/print', {
            layout: false,
            title: `ใบเสนอราคา ${quote.quote_no}`,
            quote,
            company
        });
    } catch (err) {
        console.error('[PartnerController] printQuote:', err);
        res.status(500).send('Error: ' + err.message);
    }
}

// ─── UPDATE STATUS ────────────────────────────────────────────────────────────
export async function updateStatus(req, res) {
    const { id } = req.params;
    const { status } = req.body;
    try {
        await pool.query('UPDATE partner_quotations SET status = ? WHERE id = ?', [status, id]);
        res.redirect(`/partner/quotes/${id}`);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
}

// ─── API: calculate (AJAX) ────────────────────────────────────────────────────
export async function apiCalc(req, res) {
    try {
        const result = calcQuote(req.query);

        // Auto-fetch SNG shipping rate by weight
        const w = parseFloat(req.query.weight_kg) || 0;
        const [[rateRow]] = await pool.query(
            'SELECT price FROM shipping_rates WHERE max_weight >= ? AND active = 1 ORDER BY max_weight ASC LIMIT 1',
            [w]
        );

        res.json({
            ...result,
            auto_sng_lak: rateRow ? Number(rateRow.price) : null
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// ─── Partner Dashboard ────────────────────────────────────────────────────────
export async function dashboard(req, res) {
    try {
        const [[totals]] = await pool.query(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END)    AS drafts,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END)     AS sent,
                SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
                SUM(CASE WHEN status = 'ordered' THEN 1 ELSE 0 END)  AS ordered,
                SUM(CASE WHEN status = 'ordered' THEN total_lak ELSE 0 END) AS revenue_lak
            FROM partner_quotations
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        `);
        const [recent] = await pool.query(`
            SELECT pq.*, b.name AS branch_name
            FROM partner_quotations pq
            LEFT JOIN branches b ON b.id = pq.branch_id
            ORDER BY pq.created_at DESC LIMIT 10
        `);
        res.render('partner/dashboard', {
            user: req.session.user,
            title: 'Partner — ภาพรวม',
            totals, recent
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
}
