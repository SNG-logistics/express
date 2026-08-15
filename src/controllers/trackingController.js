/**
 * src/controllers/trackingController.js
 *
 * Public tracking page — no auth required.
 * Allows customers to track their order status via job_no.
 */

import pool from '../config/db.js';
import { ORDER_STATUS_LABELS } from '../constants/statuses.js';

/**
 * GET /track/:jobNo
 * Public order tracking page
 */
export async function trackOrder(req, res) {
  const jobNo = (req.params.jobNo || '').trim().toUpperCase();

  if (!jobNo) {
    return res.render('tracking/index', {
      layout: 'layouts/public',
      order: null,
      logs: [],
      statusLabels: ORDER_STATUS_LABELS,
      error: null,
      title: `${res.locals.t('tracking.title')} | SNG Express`,
    });
  }

  try {
    const [[order]] = await pool.query(
      `SELECT o.id, o.job_no, o.direction, o.status, o.service_type,
              o.declared_weight, o.cod_amount, o.created_at, o.updated_at,
              o.delivered_at, o.screening_status,
              s.name AS sender_name, s.province AS sender_province,
              r.name AS receiver_name, r.province AS receiver_province,
              r.city AS receiver_city
       FROM orders o
       LEFT JOIN customers s ON s.id = o.sender_id
       LEFT JOIN customers r ON r.id = o.receiver_id
       WHERE o.job_no = ?`,
      [jobNo]
    );

    if (!order) {
      return res.render('tracking/index', {
        layout: 'layouts/public',
        order: null,
        logs: [],
        statusLabels: ORDER_STATUS_LABELS,
        error: `${res.locals.t('tracking.notFoundPrefix')} "${jobNo}"`,
        title: `${res.locals.t('tracking.title')} | SNG Express`,
      });
    }

    // Only show non-internal log entries to public
    const [logs] = await pool.query(
      `SELECT to_status, action_at, note
       FROM order_status_logs
       WHERE order_id = ?
         AND note NOT LIKE '%[EXCEPTION]%'
         AND note NOT LIKE '%[INTERNAL]%'
       ORDER BY action_at ASC`,
      [order.id]
    );

    res.render('tracking/index', {
      layout: 'layouts/public',
      order,
      logs,
      statusLabels: ORDER_STATUS_LABELS,
      error: null,
      title: `${res.locals.t('tracking.title')} ${order.job_no} | SNG Express`,
    });
  } catch (err) {
    console.error('[Tracking]', err);
    res.render('tracking/index', {
      layout: 'layouts/public',
      order: null,
      logs: [],
      statusLabels: ORDER_STATUS_LABELS,
      error: res.locals.t('tracking.systemError'),
      title: `${res.locals.t('tracking.title')} | SNG Express`,
    });
  }
}

/**
 * GET /track (search form landing)
 */
export async function trackLanding(req, res) {
  const q = (req.query.q || '').trim().toUpperCase();
  if (q) {
    return res.redirect(`/track/${encodeURIComponent(q)}`);
  }
  res.render('tracking/index', {
    layout: 'layouts/public',
    order: null,
    logs: [],
    statusLabels: ORDER_STATUS_LABELS,
    error: null,
    title: `${res.locals.t('tracking.title')} | SNG Express`,
  });
}
