/**
 * src/services/trackingLookupService.js
 *
 * The job_no / quote_no two-step lookup used by the public tracking page,
 * extracted so other callers (the CRM reply-grounding service) can reuse the
 * exact same resolution logic instead of duplicating it.
 */

import pool from '../config/db.js';
import { ORDER_STATUS_LABELS } from '../constants/statuses.js';

export async function loadOrderByJobNo(jobNo) {
  const [[order]] = await pool.query(
    `SELECT o.id, o.job_no, o.direction, o.status, o.service_type,
            o.declared_weight, o.cod_amount, o.created_at, o.updated_at,
            o.delivered_at, o.screening_status, o.quotation_id,
            s.name AS sender_name, s.province AS sender_province,
            r.name AS receiver_name, r.province AS receiver_province,
            r.city AS receiver_city
     FROM orders o
     LEFT JOIN customers s ON s.id = o.sender_id
     LEFT JOIN customers r ON r.id = o.receiver_id
     WHERE o.job_no = ?`,
    [jobNo]
  );
  return order || null;
}

/**
 * Resolve a ref that may be an SNG job number or a purchase-agent quote
 * number — trying it as a job number first, then falling back to the quote
 * number and following it to any shipment it later became.
 */
export async function resolveTrackingRef(ref) {
  let order = await loadOrderByJobNo(ref);
  let quotationId = order?.quotation_id || null;

  if (!order) {
    const [[quote]] = await pool.query(
      'SELECT id FROM partner_quotations WHERE quote_no = ?', [ref]
    );
    if (quote) {
      quotationId = quote.id;
      const [[linked]] = await pool.query(
        'SELECT job_no FROM orders WHERE quotation_id = ? ORDER BY id DESC LIMIT 1',
        [quote.id]
      );
      if (linked) order = await loadOrderByJobNo(linked.job_no);
    }
  }

  return { order, quotationId };
}

/**
 * A customer-safe minimal summary for surfaces (like an AI-drafted reply)
 * that must never leak internal fields (cod_amount, screening_status,
 * internal notes) that the full tracking page is allowed to use.
 */
export async function lookupTrackingSummary(rawRef) {
  const ref = String(rawRef || '').trim().toUpperCase();
  if (!ref) return { found: false, ref: '' };

  const { order, quotationId } = await resolveTrackingRef(ref);
  if (!order && !quotationId) return { found: false, ref };

  return {
    found: true,
    ref,
    hasShipmentLeg: Boolean(order),
    jobNo: order?.job_no || null,
    statusLabel: order ? (ORDER_STATUS_LABELS[order.status]?.label || null) : null,
    receiverProvince: order?.receiver_province || null,
    deliveredAt: order?.delivered_at || null,
    updatedAt: order?.updated_at || null,
  };
}
