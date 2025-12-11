import * as customsModel from '../models/customsModel.js';
import pool from '../config/db.js';

export async function list(req, res) {
  const pending = await customsModel.getPendingOrders();
  res.render('customs/create', {
    user: req.session.user,
    title: 'Customs Queue',
    pending,
    error: null
  });
}

export async function detail(req, res) {
  const { id } = req.params;
  const { order, logs, payments } = await customsModel.getOrderWithLogs(id);
  if (!order) return res.status(404).send('Order not found');
  res.render('customs/detail', {
    user: req.session.user,
    title: `Customs ${order.job_no}`,
    order,
    logs,
    payments,
    error: null
  });
}

export async function start(req, res) {
  const { id } = req.params;
  const { fee_amount, note } = req.body;
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) return res.status(404).send('Order not found');
  if (!['CROSSING_BORDER', 'ARRIVED_BORDER_WH', 'CUSTOMS_CLEARANCE'].includes(order.status)) {
    return res.status(400).send('Order not ready for customs clearance');
  }
  try {
    await customsModel.startClearance(order, fee_amount ? Number(fee_amount) : 0, note, req.session.user?.id);
    res.redirect(`/customs/${id}`);
  } catch (err) {
    const { logs, payments } = await customsModel.getOrderWithLogs(id);
    res.render('customs/detail', {
      user: req.session.user,
      title: `Customs ${order.job_no}`,
      order,
      logs,
      payments,
      error: err.message
    });
  }
}

export async function clear(req, res) {
  const { id } = req.params;
  const { note } = req.body;
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) return res.status(404).send('Order not found');
  if (order.status !== 'CUSTOMS_CLEARANCE') {
    return res.status(400).send('Order not in CUSTOMS_CLEARANCE status');
  }
  try {
    await customsModel.clearOrder(order, note, req.session.user?.id);
    res.redirect(`/customs/${id}`);
  } catch (err) {
    const { logs, payments } = await customsModel.getOrderWithLogs(id);
    res.render('customs/detail', {
      user: req.session.user,
      title: `Customs ${order.job_no}`,
      order,
      logs,
      payments,
      error: err.message
    });
  }
}
