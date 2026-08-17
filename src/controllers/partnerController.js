import pool from '../config/db.js';
import { withTransaction } from '../services/orderWorkflowService.js';
import { getLatestRate } from '../services/exchangeRateService.js';
import { previewPurchaseAgentQuote, resolvePurchaseAgentQuote } from '../services/purchaseAgentPricingService.js';
import { transitionQuotation } from '../services/quotationWorkflowService.js';
import { getNextQuotationStatuses } from '../constants/transitions.js';
import { enqueuePurchaseAgentNotification, kickNotificationWorker } from '../services/notificationService.js';

// Statuses a quotation may be persisted in directly at create time.
// (Most rows start life as 'draft'; staff push them forward from the detail
// page via the guarded transition buttons.)
const QUOTE_STATUSES = new Set(['draft', 'sent', 'accepted', 'purchasing', 'purchased', 'ordered', 'cancelled', 'rejected']);

function quoteRequestStatusForQuotation(status) {
    if (['sent', 'accepted', 'purchasing', 'purchased', 'ordered'].includes(status)) return 'quoted';
    if (['cancelled', 'rejected'].includes(status)) return 'closed';
    return 'in_progress';
}

// ─── Helper: format date as YYYYMMDD ─────────────────────────────────────────
function dateStr(d = new Date()) {
    return d.getFullYear().toString()
        + String(d.getMonth() + 1).padStart(2, '0')
        + String(d.getDate()).padStart(2, '0');
}


/**
 * Collision-safe quote number. The old COUNT(*)+1 implementation was not
 * atomic (real collision risk on Phusion Passenger's multi-worker setup) —
 * the UNIQUE constraint from migrate_029 is now the actual safety net, and
 * this generate → check → retry-up-to-5x loop (same idiom as job_no in
 * ordersController.create()) avoids most collisions before they happen.
 */
async function genQuoteNo() {
    const d = dateStr();
    for (let attempt = 0; attempt < 5; attempt++) {
        const [[row]] = await pool.query(
            `SELECT COUNT(*) AS cnt FROM partner_quotations WHERE DATE(created_at) = CURDATE()`
        );
        const seq = String((row.cnt || 0) + 1 + attempt).padStart(4, '0');
        const quoteNo = `PQ-${d}-${seq}`;
        const [[exists]] = await pool.query('SELECT id FROM partner_quotations WHERE quote_no = ?', [quoteNo]);
        if (!exists) return quoteNo;
    }
    // Extremely unlikely: 5 attempts all hit collisions under a busy day.
    return `PQ-${d}-${Date.now().toString().slice(-4)}`;
}

async function findQuoteRequestByQuotation(conn, quotationId) {
    const [[row]] = await conn.query(
        'SELECT id FROM product_quote_requests WHERE linked_quotation_id = ? LIMIT 1',
        [quotationId]
    );
    return row || null;
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
        const fxRate = await getLatestRate(pool, 'THB_LAK');
        const [shippingRates] = await pool.query(
            'SELECT * FROM shipping_rates WHERE active = 1 ORDER BY max_weight ASC'
        );
        const [settingsRows] = await pool.query(
            `SELECT setting_key, setting_value FROM company_settings
             WHERE setting_key IN ('purchase_agent_fee_min_lak','purchase_agent_fee_pct')`
        );
        const settings = Object.fromEntries(settingsRows.map(r => [r.setting_key, r.setting_value]));
        res.render('partner/quotes/new', {
            user: req.session.user,
            title: 'สร้างใบเสนอราคา',
            branches,
            fx_rate: fxRate,
            shippingRates,
            fee_min_lak: settings.purchase_agent_fee_min_lak || 20000,
            fee_pct: settings.purchase_agent_fee_pct || 6,
            request: null,
            error: null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
}

// ─── CREATE ───────────────────────────────────────────────────────────────────
async function insertQuotation(conn, req, calc) {
    const {
        branch_id, product_url, product_name, product_price_thb,
        shipping_th_thb, weight_kg, exchange_rate, fx_spread_pct,
        sng_shipping_lak,
        customer_name, customer_phone, customer_address, note,
        quote_request_id, platform, desired_qty
    } = req.body;

    const quote_no = await genQuoteNo();

    const [result] = await conn.query(
        `INSERT INTO partner_quotations
         (branch_id, created_by, quote_no, product_url, platform, product_name, desired_qty,
          product_price_thb, shipping_th_thb, weight_kg,
          exchange_rate, fx_spread_pct, sng_shipping_lak, service_fee_lak,
          subtotal_thb, total_lak, deposit_required_lak,
          customer_name, customer_phone, customer_address, note, status)
         VALUES (?,?,?,?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?,?,?,?,?)`,
        [
            branch_id || null, req.session.user?.id, quote_no,
            product_url || null, platform || 'other', product_name,
            Math.max(1, parseInt(desired_qty, 10) || 1),
            parseFloat(product_price_thb) || 0,
            parseFloat(shipping_th_thb) || 0,
            parseFloat(weight_kg) || 0,
            calc.effectiveRate / (1 + (parseFloat(fx_spread_pct) || 0) / 100), // store BASE rate
            parseFloat(fx_spread_pct) || 0,
            parseFloat(sng_shipping_lak) || 0, // SNG shipping fee in LAK from form
            calc.serviceFeeLak,
            calc.subtotalThb, calc.totalLak, calc.productLak,
            customer_name || null, customer_phone || null,
            customer_address || null, note || null,
            'draft' // always insert as draft; non-draft statuses go through transitionQuotation below
        ]
    );

    // Link + mirror the request row.
    const requestId = Number(quote_request_id) || null;
    if (requestId) {
        await conn.query(
            `UPDATE product_quote_requests
             SET linked_quotation_id = ?, status = ?
             WHERE id = ?`,
            [result.insertId, quoteRequestStatusForQuotation('draft'), requestId]
        );
    }

    return { id: result.insertId, requestId };
}

export async function create(req, res) {
    const {
        product_price_thb, desired_qty, shipping_th_thb,
        exchange_rate, fx_spread_pct, sng_shipping_lak,
        status: submittedStatus
    } = req.body;
    const quoteStatus = QUOTE_STATUSES.has(submittedStatus) ? submittedStatus : 'draft';

    // The UNIQUE(quote_no) constraint from migrate_029 is the real safety net.
    // On the rare concurrent-insert collision we simply re-run the transaction
    // with a fresh number instead of surfacing a 500 to staff.
    try {
        let newId = null;
        for (let attempt = 0; attempt < 5 && !newId; attempt++) {
            try {
                newId = await withTransaction(async (conn) => {
                    const [settingsRows] = await conn.query(
                        `SELECT setting_key, setting_value FROM company_settings
                         WHERE setting_key IN ('purchase_agent_fee_min_lak','purchase_agent_fee_pct')`
                    );
                    const settings = Object.fromEntries(settingsRows.map(r => [r.setting_key, r.setting_value]));

                    const calc = await resolvePurchaseAgentQuote(conn, {
                        product_price_thb,
                        desired_qty,
                        shipping_th_thb,
                        exchange_rate,
                        fx_spread_pct,
                        sng_shipping_lak,
                        companySettings: settings,
                    });

                    return await insertQuotation(conn, req, calc);
                });
            } catch (err) {
                if (err.code === 'ER_DUP_ENTRY' && err.message.includes('uq_pq_quote_no')) {
                    console.warn('[Partner create] quote_no collision, retrying…');
                    continue; // regenerate quote_no and re-run
                }
                throw err;
            }
        }
        if (!newId) {
            throw new Error('ไม่สามารถสร้างเลขใบเสนอราคาได้ไม่ซ้ำ กรุณาลองใหม่');
        }

        // If staff marked it sent/accepted at creation, drive the guarded
        // transition machinery so the status log + customer notification fire.
        if (quoteStatus !== 'draft') {
            await transitionQuotation({
                quotationId: newId.id,
                toStatus: quoteStatus,
                userId: req.session.user?.id,
                note: 'Created directly in final status',
            });
            if (newId.requestId) {
                await pool.query(
                    'UPDATE product_quote_requests SET status = ? WHERE id = ?',
                    [quoteRequestStatusForQuotation(quoteStatus), newId.requestId]
                );
            }
        }

        res.redirect(`/partner/quotes/${newId.id}`);
    } catch (err) {
        console.error('[Partner create]', err);
        res.status(500).send(err.message);
    }
}

// ─── DETAIL ───────────────────────────────────────────────────────────────────
export async function detail(req, res) {
    const { id } = req.params;
    try {
        const [[quote]] = await pool.query(
            `SELECT pq.*, b.name AS branch_name, u.username AS creator,
                    o.id AS linked_order_id, o.job_no AS linked_order_job_no
             FROM partner_quotations pq
             LEFT JOIN branches b ON b.id = pq.branch_id
             LEFT JOIN users u ON u.id = pq.created_by
             LEFT JOIN orders o ON o.quotation_id = pq.id
             WHERE pq.id = ?`, [id]
        );
        if (!quote) return res.status(404).send('ไม่พบใบเสนอราคา');

        const [logs] = await pool.query(
            `SELECT pqsl.*, u.username, ca.first_name AS customer_first_name, ca.last_name AS customer_last_name
             FROM partner_quotation_status_logs pqsl
             LEFT JOIN users u ON u.id = pqsl.action_by
             LEFT JOIN customer_accounts ca ON ca.id = pqsl.action_by_customer_id
             WHERE pqsl.quotation_id = ?
             ORDER BY pqsl.action_at ASC`, [id]
        );

        res.render('partner/quotes/detail', {
            user: req.session.user,
            title: `ใบเสนอราคา ${quote.quote_no}`,
            quote,
            logs,
            nextStatuses: getNextQuotationStatuses(quote.status),
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

// ─── TRANSITION (guarded, replaces the unguarded updateStatus) ───────────────
export async function transitionQuote(req, res) {
    const { id } = req.params;
    const { status: toStatus } = req.body;
    if (!QUOTE_STATUSES.has(toStatus)) {
        req.session.flash = { type: 'error', message: 'สถานะไม่ถูกต้อง' };
        return res.redirect(`/partner/quotes/${id}`);
    }
    try {
        await transitionQuotation({
            quotationId: id,
            toStatus,
            userId: req.session.user?.id,
            note: req.body.note || null,
        });
        const request = await findQuoteRequestByQuotation(pool, id);
        if (request) {
            await pool.query(
                'UPDATE product_quote_requests SET status = ? WHERE id = ?',
                [quoteRequestStatusForQuotation(toStatus), request.id]
            );
        }
        req.session.flash = { type: 'success', message: `อัปเดตสถานะเป็น ${toStatus} แล้ว` };
    } catch (err) {
        console.error('[Partner transitionQuote]', err);
        req.session.flash = { type: 'error', message: err.message };
    }
    res.redirect(`/partner/quotes/${id}`);
}

// Backward-compat alias used by the old /status form.
export async function updateStatus(req, res) {
    return transitionQuote(req, res);
}

// ─── RECORD DEPOSIT PAYMENT (mirrors spaceBookingController.recordPayment) ───
export async function recordQuotePayment(req, res) {
    const { id } = req.params;
    const { paid_amount, payment_ref } = req.body;
    const userId = req.session.user?.id;

    try {
        await withTransaction(async (conn) => {
            const [[quote]] = await conn.query(
                `SELECT id, status, quote_no, deposit_required_lak, paid_amount_lak, payment_status
                 FROM partner_quotations WHERE id = ? FOR UPDATE`,
                [id]
            );
            if (!quote) throw new Error('ไม่พบใบเสนอราคา');

            const paymentAmount = Number(paid_amount);
            if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
                throw new Error('ยอดชำระต้องมากกว่า 0');
            }
            if (['cancelled', 'rejected', 'ordered'].includes(quote.status)) {
                throw new Error('ไม่สามารถรับชำระใบเสนอราคาที่ปิด/สั่งซื้อแล้ว');
            }

            const newPaid = Number(quote.paid_amount_lak) + paymentAmount;
            const deposit = Number(quote.deposit_required_lak) || 0;
            const payStatus = deposit > 0 && newPaid >= deposit
                ? 'PAID'
                : newPaid > 0 ? 'PARTIAL' : 'UNPAID';

            await conn.query(
                `UPDATE partner_quotations SET
                   paid_amount_lak = ?, payment_status = ?,
                   payment_ref = ?, paid_at = IF(? >= deposit_required_lak, NOW(), paid_at),
                   updated_at = NOW()
                 WHERE id = ?`,
                [newPaid, payStatus, payment_ref || null, newPaid, id]
            );
            await conn.query(
                `INSERT INTO partner_quotation_status_logs
                   (quotation_id, from_status, to_status, note, action_by, action_at)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [id, quote.status, quote.status,
                 `[PAYMENT] รับชำระมัดจำ ₭${paymentAmount.toLocaleString()} — ${payment_ref || ''}`, userId]
            );
            await enqueuePurchaseAgentNotification(conn, {
                quotationId: id,
                eventType: 'PURCHASE_AGENT:DEPOSIT_RECORDED',
                eventKey: `PURCHASE_AGENT:${quote.quote_no}:DEPOSIT:${Date.now()}`,
                extraPayload: { paidLak: paymentAmount, depositLak: deposit },
            });
        });
        kickNotificationWorker();
        req.session.flash = { type: 'success', message: 'บันทึกการชำระมัดจำสำเร็จ' };
    } catch (err) {
        console.error('[Partner recordQuotePayment]', err);
        req.session.flash = { type: 'error', message: err.message };
    }
    res.redirect(`/partner/quotes/${id}`);
}

// ─── API: calculate (AJAX) — now backed by the shared purchase-agent calculator
export async function apiCalc(req, res) {
    try {
        const result = await previewPurchaseAgentQuote(req.query);

        // Auto-fetch SNG shipping rate by weight (kept as a hint).
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
            `SELECT pqr.id, pqr.product_url, pqr.product_name, pqr.platform, pqr.desired_qty,
                    pqr.note, pqr.status, pqr.linked_quotation_id, pqr.decline_reason,
                    pqr.acknowledged_at, pqr.created_at,
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

// ─── Acknowledge a request (new → in_progress) ───────────────────────────────
export async function acknowledgeRequest(req, res) {
    const { id } = req.params;
    try {
        const [result] = await pool.query(
            `UPDATE product_quote_requests
             SET status = 'in_progress', acknowledged_at = NOW(), acknowledged_by = ?
             WHERE id = ? AND status = 'new'`,
            [req.session.user?.id || null, id]
        );
        if (result.affectedRows === 0) {
            req.session.flash = { type: 'error', message: 'คำขอนี้ไม่สามารถรับดำเนินการได้ (อาจถูกจัดการไปแล้ว)' };
        } else {
            req.session.flash = { type: 'success', message: 'รับคำขอเข้างานแล้ว' };
        }
    } catch (err) {
        console.error('[Partner acknowledgeRequest]', err);
        req.session.flash = { type: 'error', message: err.message };
    }
    res.redirect('/partner/quote-requests');
}

// ─── Decline a request (→ closed) — REQUIRES a reason ────────────────────────
export async function declineRequest(req, res) {
    const { id } = req.params;
    const reason = String(req.body.reason || '').trim();
    if (!reason) {
        req.session.flash = { type: 'error', message: 'กรุณาระบุเหตุผลที่ปฏิเสธคำขอ' };
        return res.redirect('/partner/quote-requests');
    }
    try {
        const [result] = await pool.query(
            `UPDATE product_quote_requests
             SET status = 'closed', decline_reason = ?, acknowledged_at = COALESCE(acknowledged_at, NOW())
             WHERE id = ? AND status IN ('new','in_progress')`,
            [reason, id]
        );
        if (result.affectedRows === 0) {
            req.session.flash = { type: 'error', message: 'คำขอนี้ไม่สามารถปฏิเสธได้ (มีใบเสนอราคาแล้วหรือปิดแล้ว)' };
        } else {
            await enqueuePurchaseAgentNotification(pool, {
                quoteRequestId: id,
                eventType: 'PURCHASE_AGENT:DECLINED',
                eventKey: `PURCHASE_AGENT:REQUEST_DECLINED:${id}`,
                extraPayload: { reason },
            });
            kickNotificationWorker();
            req.session.flash = { type: 'success', message: 'ปฏิเสธคำขอและแจ้งลูกค้าแล้ว' };
        }
    } catch (err) {
        console.error('[Partner declineRequest]', err);
        req.session.flash = { type: 'error', message: err.message };
    }
    res.redirect('/partner/quote-requests');
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
        const fxRate = await getLatestRate(pool, 'THB_LAK');
        const [shippingRates] = await pool.query(
            'SELECT * FROM shipping_rates WHERE active = 1 ORDER BY max_weight ASC'
        );
        const [settingsRows] = await pool.query(
            `SELECT setting_key, setting_value FROM company_settings
             WHERE setting_key IN ('purchase_agent_fee_min_lak','purchase_agent_fee_pct')`
        );
        const settings = Object.fromEntries(settingsRows.map(r => [r.setting_key, r.setting_value]));

        res.render('partner/quotes/new', {
            user: req.session.user,
            title: 'สร้างใบเสนอราคาจากคำขอลูกค้า',
            branches,
            fx_rate: fxRate,
            shippingRates,
            fee_min_lak: settings.purchase_agent_fee_min_lak || 20000,
            fee_pct: settings.purchase_agent_fee_pct || 6,
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
