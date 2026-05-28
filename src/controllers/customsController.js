/**
 * customsController.js — Customs clearance controller
 *
 * Statuses handled:
 *   CROSSING_BORDER | ARRIVED_BORDER_WH → CUSTOMS_HOLD → CUSTOMS_CLEARED → ARRIVED_BORDER_WH
 *                                       → CUSTOMS_REJECTED → CLOSED
 *
 * Legacy strings 'CUSTOMS_CLEARANCE' and 'CLEARED' no longer written here.
 */
import * as customsModel from '../models/customsModel.js';
import { getCustomsSummary } from '../models/dashboardModel.js';
import pool from '../config/db.js';
import { ORDER_STATUS } from '../constants/statuses.js';

// ─── List all customs-eligible orders ────────────────────────────────────────

export async function list(req, res) {
  try {
    const pending = await customsModel.getPendingOrders();
    const { clearedThisMonth, rejectedThisMonth } = await getCustomsSummary();

    res.render('customs/create', {
      title: 'Customs Queue',
      pending,
      clearedThisMonth,
      rejectedThisMonth,
      error: null,
    });
  } catch (err) {
    console.error('[Customs.list]', err);
    res.status(500).send('Error loading customs: ' + err.message);
  }
}

// ─── Order detail ─────────────────────────────────────────────────────────────

export async function detail(req, res) {
  try {
    const { id } = req.params;
    const { order, logs, payments } = await customsModel.getOrderWithLogs(id);
    if (!order) {
      req.session.flash = { type: 'error', message: 'ไม่พบ order' };
      return res.redirect('/customs');
    }
    res.render('customs/detail', {
      user: req.session.user,
      title: `Customs — ${order.job_no}`,
      order,
      logs,
      payments,
      error: null,
    });
  } catch (err) {
    console.error('[Customs.detail]', err);
    res.status(500).send(err.message);
  }
}

// ─── Start clearance: eligible → CUSTOMS_HOLD ────────────────────────────────

export async function start(req, res) {
  const { id } = req.params;
  const { fee_amount, note } = req.body;

  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'ไม่พบ order' };
    return res.redirect('/customs');
  }

  try {
    await customsModel.startClearance(
      order,
      fee_amount ? Number(fee_amount) : 0,
      note,
      req.session.user?.id
    );
    req.session.flash = { type: 'success', message: `Order ${order.job_no} เข้าสู่ CUSTOMS_HOLD` };
    res.redirect(`/customs/${id}`);
  } catch (err) {
    const { logs, payments } = await customsModel.getOrderWithLogs(id);
    res.render('customs/detail', {
      user: req.session.user,
      title: `Customs — ${order.job_no}`,
      order,
      logs,
      payments,
      error: err.message,
    });
  }
}

// ─── Clear: CUSTOMS_HOLD → CUSTOMS_CLEARED → ARRIVED_BORDER_WH ───────────────

export async function clear(req, res) {
  const { id } = req.params;
  const { note } = req.body;

  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'ไม่พบ order' };
    return res.redirect('/customs');
  }

  // Guard: must be CUSTOMS_HOLD (drop legacy CUSTOMS_CLEARANCE check)
  if (order.status !== ORDER_STATUS.CUSTOMS_HOLD) {
    req.session.flash = {
      type: 'error',
      message: `Order ${order.job_no} อยู่ใน "${order.status}" — ต้องอยู่ใน CUSTOMS_HOLD ก่อน`,
    };
    return res.redirect(`/customs/${id}`);
  }

  try {
    await customsModel.clearOrder(order, note, req.session.user?.id);
    req.session.flash = { type: 'success', message: `Order ${order.job_no} ผ่านพิธีศุลกากรแล้ว` };
    res.redirect(`/customs/${id}`);
  } catch (err) {
    const { logs, payments } = await customsModel.getOrderWithLogs(id);
    res.render('customs/detail', {
      user: req.session.user,
      title: `Customs — ${order.job_no}`,
      order,
      logs,
      payments,
      error: err.message,
    });
  }
}

// ─── Reject: CUSTOMS_HOLD → CUSTOMS_REJECTED ─────────────────────────────────

export async function reject(req, res) {
  const { id } = req.params;
  const { reason } = req.body;

  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'ไม่พบ order' };
    return res.redirect('/customs');
  }

  if (order.status !== ORDER_STATUS.CUSTOMS_HOLD) {
    req.session.flash = {
      type: 'error',
      message: `Order ${order.job_no} อยู่ใน "${order.status}" — ต้องอยู่ใน CUSTOMS_HOLD ก่อน Reject`,
    };
    return res.redirect(`/customs/${id}`);
  }

  try {
    await customsModel.rejectOrder(order, reason, req.session.user?.id);
    req.session.flash = { type: 'success', message: `Order ${order.job_no} ถูก Reject โดยศุลกากร` };
    res.redirect(`/customs/${id}`);
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
    res.redirect(`/customs/${id}`);
  }
}
