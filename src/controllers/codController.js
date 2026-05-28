/**
 * codController.js — COD collection & remittance controller
 *
 * Tabs:
 *   collection  — orders delivered, COD pending/not yet collected
 *   remittance  — orders COD collected, waiting to be remitted
 *   history     — orders COD remitted/closed (audit trail)
 */
import * as codModel from '../models/codModel.js';
import { getCodSummary } from '../models/dashboardModel.js';
import pool from '../config/db.js';
import { ORDER_STATUS, ORDER_STATUS_LABELS } from '../constants/statuses.js';

// ─── List page ────────────────────────────────────────────────────────────────

export async function index(req, res) {
  try {
    const tab = req.query.tab || 'collection';
    let query;

    if (tab === 'remittance') {
      // Collected — waiting for remittance to sender
      query = `
        SELECT o.id, o.job_no, o.direction, o.status, o.cod_amount,
               s.name AS sender_name, s.phone AS sender_phone,
               r.name AS receiver_name, r.phone AS receiver_phone,
               cs.status AS cod_status, cs.collected_at, cs.remitted_to
        FROM orders o
        LEFT JOIN customers s ON s.id = o.sender_id
        LEFT JOIN customers r ON r.id = o.receiver_id
        LEFT JOIN cod_settlements cs ON cs.order_id = o.id
        WHERE o.cod_amount > 0 AND cs.status = 'COLLECTED'
        ORDER BY cs.collected_at ASC
      `;
    } else if (tab === 'history') {
      // Already remitted — audit trail
      query = `
        SELECT o.id, o.job_no, o.direction, o.status, o.cod_amount,
               s.name AS sender_name,
               r.name AS receiver_name,
               cs.status AS cod_status, cs.collected_at, cs.remitted_at, cs.remitted_to
        FROM orders o
        LEFT JOIN customers s ON s.id = o.sender_id
        LEFT JOIN customers r ON r.id = o.receiver_id
        LEFT JOIN cod_settlements cs ON cs.order_id = o.id
        WHERE o.cod_amount > 0 AND cs.status = 'REMITTED'
        ORDER BY cs.remitted_at DESC
        LIMIT 100
      `;
    } else {
      // Default: collection tab — DELIVERED with unpaid COD
      query = `
        SELECT o.id, o.job_no, o.direction, o.status, o.cod_amount,
               s.name AS sender_name, s.phone AS sender_phone,
               r.name AS receiver_name, r.phone AS receiver_phone,
               cs.status AS cod_status, cs.collected_at,
               DATEDIFF(NOW(), o.updated_at) AS days_pending
        FROM orders o
        LEFT JOIN customers s ON s.id = o.sender_id
        LEFT JOIN customers r ON r.id = o.receiver_id
        LEFT JOIN cod_settlements cs ON cs.order_id = o.id
        WHERE o.cod_amount > 0
          AND o.status NOT IN ('CLOSED', 'RETURN_TO_SENDER', 'DELIVERY_FAILED', 'CUSTOMS_REJECTED')
          AND (cs.status IS NULL OR cs.status = 'PENDING')
        ORDER BY o.updated_at ASC
      `;
    }

    const [items] = await pool.query(query);

    // Summary bar (lightweight — separate query)
    const summary = await getCodSummary();

    // Tab badge counts
    const [[colCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM orders o
       LEFT JOIN cod_settlements cs ON cs.order_id = o.id
       WHERE o.cod_amount > 0 AND o.status NOT IN ('CLOSED', 'RETURN_TO_SENDER', 'DELIVERY_FAILED', 'CUSTOMS_REJECTED')
         AND (cs.status IS NULL OR cs.status = 'PENDING')`
    );
    const [[remitCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM cod_settlements WHERE status = 'COLLECTED'`
    );

    res.render('cod/index', {
      title: 'COD Management',
      items,
      tab,
      summary,
      counts: { collection: colCount.cnt, remittance: remitCount.cnt },
      orderStatusLabels: ORDER_STATUS_LABELS,
      error: null,
    });
  } catch (err) {
    console.error('[COD.index]', err);
    res.status(500).send('Error loading COD: ' + err.message);
  }
}

// ─── Set / update COD amount ──────────────────────────────────────────────────

export async function setAmount(req, res) {
  try {
    const { id } = req.params;
    const amount = Number(req.body.cod_amount);
    if (Number.isNaN(amount) || amount < 0) {
      req.session.flash = { type: 'error', message: 'จำนวน COD ไม่ถูกต้อง' };
      return res.redirect('/cod');
    }
    const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
    if (!order) {
      req.session.flash = { type: 'error', message: 'ไม่พบ order' };
      return res.redirect('/cod');
    }
    await pool.query('UPDATE orders SET cod_amount = ? WHERE id = ?', [amount, id]);
    await codModel.ensureCodRow(id, amount);
    req.session.flash = { type: 'success', message: 'อัปเดต COD แล้ว' };
    res.redirect('/cod');
  } catch (err) {
    console.error('[COD.setAmount]', err);
    req.session.flash = { type: 'error', message: err.message };
    res.redirect('/cod');
  }
}

// ─── Mark collected ───────────────────────────────────────────────────────────

export async function markCollected(req, res) {
  try {
    const { id } = req.params;
    await codModel.markCollected(id, req.session.user?.id);
    req.session.flash = { type: 'success', message: 'บันทึกรับ COD แล้ว' };
    res.redirect('/cod?tab=remittance');
  } catch (err) {
    console.error('[COD.markCollected]', err);
    req.session.flash = { type: 'error', message: err.message };
    res.redirect('/cod?tab=collection');
  }
}

// ─── Mark remitted ────────────────────────────────────────────────────────────

export async function markRemitted(req, res) {
  try {
    const { id } = req.params;
    const { remitted_to } = req.body;
    if (!remitted_to?.trim()) {
      req.session.flash = { type: 'error', message: 'ต้องระบุชื่อผู้รับโอน COD' };
      return res.redirect('/cod?tab=remittance');
    }
    await codModel.markRemitted(id, remitted_to.trim(), req.session.user?.id);
    req.session.flash = { type: 'success', message: `โอน COD ให้ "${remitted_to}" แล้ว — order เปลี่ยนเป็น COD_REMITTED` };
    res.redirect('/cod?tab=history');
  } catch (err) {
    console.error('[COD.markRemitted]', err);
    req.session.flash = { type: 'error', message: err.message };
    res.redirect('/cod?tab=remittance');
  }
}

// ─── Close after remit ────────────────────────────────────────────────────────

export async function closeAfterRemit(req, res) {
  try {
    const { id } = req.params;
    await codModel.closeAfterRemit(id, req.session.user?.id);
    req.session.flash = { type: 'success', message: 'ปิด order เรียบร้อย' };
    res.redirect(`/orders/${id}`);
  } catch (err) {
    console.error('[COD.closeAfterRemit]', err);
    req.session.flash = { type: 'error', message: err.message };
    res.redirect('/cod?tab=history');
  }
}
