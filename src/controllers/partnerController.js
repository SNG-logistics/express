import pool from '../config/db.js';

const QUOTE_STATUSES = new Set(['draft', 'sent', 'accepted', 'ordered', 'cancelled']);

function quoteRequestStatusForQuotation(status) {
    if (['sent', 'accepted', 'ordered'].includes(status)) return 'quoted';
    if (status === 'cancelled') return 'closed';
    return 'in_progress';
}

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
        customer_name, customer_phone, customer_address, note, status: submittedStatus,
        quote_request_id
    } = req.body;

    try {
        const { subtotalThb, totalLak } = calcQuote({
            product_price_thb, shipping_th_thb, exchange_rate,
            fx_spread_pct, sng_shipping_lak, service_fee_lak
        });
        const quote_no = await genQuoteNo();
        const quoteStatus = QUOTE_STATUSES.has(submittedStatus) ? submittedStatus : 'draft';

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
                quoteStatus
            ]
        );
        const [[inserted]] = await pool.query(
            'SELECT id FROM partner_quotations WHERE quote_no = ? LIMIT 1', [quote_no]
        );

        // A request receives a customer-visible quotation only after staff marks
        // it sent/accepted/ordered. Drafts remain internal work in progress.
        const requestId = Number(quote_request_id) || null;
        if (requestId) {
            await pool.query(
                `UPDATE product_quote_requests
                 SET linked_quotation_id = ?, status = ?
                 WHERE id = ?`,
                [inserted.id, quoteRequestStatusForQuotation(quoteStatus), requestId]
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
    const { status: submittedStatus } = req.body;
    const status = QUOTE_STATUSES.has(submittedStatus) ? submittedStatus : null;
    if (!status) return res.status(400).send('Invalid quotation status');

    try {
        const [result] = await pool.query('UPDATE partner_quotations SET status = ? WHERE id = ?', [status, id]);
        if (result.affectedRows === 0) return res.status(404).send('ไม่พบใบเสนอราคา');

        await pool.query(
            'UPDATE product_quote_requests SET status = ? WHERE linked_quotation_id = ?',
            [quoteRequestStatusForQuotation(status), id]
        );
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

// ─── Quote Requests Queue (from public member portal) ─────────────────────────
// Polled by the staff queue page. It intentionally returns only fresh requests:
// once staff begins a draft or sends a quotation, it no longer alerts.
export async function pendingQuoteRequestsApi(req, res) {
    try {
        const [requests] = await pool.query(
            `SELECT pqr.id, pqr.product_name, pqr.desired_qty, pqr.note, pqr.created_at,
                    ca.first_name, ca.last_name, ca.phone, ca.phone_display
             FROM product_quote_requests pqr
             LEFT JOIN customer_accounts ca ON ca.id = pqr.customer_account_id
             WHERE pqr.status = 'new'
             ORDER BY pqr.created_at DESC
             LIMIT 50`
        );

        res.set('Cache-Control', 'no-store');
        res.json({ requests });
    } catch (err) {
        console.error('[Partner Quote Request Alerts]', err);
        res.status(500).json({ error: 'Unable to load pending quote requests' });
    }
}

export async function quoteRequestQueue(req, res) {
    try {
        const [requests] = await pool.query(
            `SELECT pqr.id, pqr.product_url, pqr.product_name, pqr.desired_qty,
                    pqr.note, pqr.status, pqr.linked_quotation_id, pqr.created_at,
                    ca.first_name, ca.last_name, ca.phone, ca.phone_display
             FROM product_quote_requests pqr
             LEFT JOIN customer_accounts ca ON ca.id = pqr.customer_account_id
             ORDER BY FIELD(pqr.status, 'new','in_progress','quoted','closed'), pqr.created_at DESC`
        );

        res.render('partner/quote-requests', {
            user: req.session.user,
            title: 'คำขอเช็คราคาสินค้า',
            requests
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
}

// ─── Convert a public request into a quotation (pre-fill newForm) ─────────────
export async function convertRequest(req, res) {
    const { id } = req.params;
    try {
        const [[request]] = await pool.query(
            `SELECT pqr.*,
                    ca.first_name, ca.last_name, ca.phone, ca.phone_display
             FROM product_quote_requests pqr
             LEFT JOIN customer_accounts ca ON ca.id = pqr.customer_account_id
             WHERE pqr.id = ?`,
            [id]
        );
        if (!request) return res.status(404).send('ไม่พบคำขอเช็คราคา');

        const [branches] = await pool.query(
            "SELECT id, name FROM branches WHERE status = 'active' ORDER BY name"
        );
        const [[fx]] = await pool.query(
            "SELECT rate FROM exchange_rates WHERE pair = 'THB_LAK' ORDER BY created_at DESC LIMIT 1"
        );
        const [shippingRates] = await pool.query(
            'SELECT * FROM shipping_rates WHERE active = 1 ORDER BY max_weight ASC'
        );

        res.render('partner/quotes/new', {
            user: req.session.user,
            title: 'สร้างใบเสนอราคาจากคำขอลูกค้า',
            branches,
            fx_rate: fx?.rate || 200,
            shippingRates,
            request,
            error: null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
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
        const [[{ pending_requests }]] = await pool.query(
            `SELECT COUNT(*) AS pending_requests
             FROM product_quote_requests
             WHERE status IN ('new','in_progress')`
        );
        const [recentRequests] = await pool.query(
            `SELECT pqr.id, pqr.product_name, pqr.status, pqr.created_at,
                    ca.phone_display
             FROM product_quote_requests pqr
             LEFT JOIN customer_accounts ca ON ca.id = pqr.customer_account_id
             ORDER BY pqr.created_at DESC LIMIT 5`
        );
        res.render('partner/dashboard', {
            user: req.session.user,
            title: 'Partner — ภาพรวม',
            totals, recent,
            pending_requests,
            recentRequests
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
}
