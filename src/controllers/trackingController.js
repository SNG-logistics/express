/**
 * src/controllers/trackingController.js
 *
 * Public tracking page — no auth required.
 *
 * A purchase-agent parcel is one journey in two halves: the shop's courier
 * brings the goods to SNG's Thai warehouse, then SNG carries them to Laos. The
 * customer holds a quotation number for the first half and an SNG job number
 * only once the second begins, so this page accepts either and always shows
 * whichever halves exist — searching by one number must never hide the other.
 *
 * What it deliberately never shows: the platform, the shop, or the courier's
 * own tracking number. Those are staff-only by the owner's decision.
 */

import pool from '../config/db.js';
import { ORDER_STATUS_LABELS } from '../constants/statuses.js';
import { buildTrackingTimeline, buildSupplierTimeline } from '../constants/trackingSteps.js';
import { parcelProgress } from '../services/quotationParcelService.js';
import { resolveTrackingRef } from '../services/trackingLookupService.js';

/** Everything the view needs when nothing was found, so no branch renders undefined. */
function emptyView(res, { error = null, title = null } = {}) {
  return {
    layout: 'customer/layout',
    order: null,
    logs: [],
    timeline: [],
    quotation: null,
    supplierTimeline: [],
    supplierProgress: null,
    statusLabels: ORDER_STATUS_LABELS,
    error,
    title: title || `${res.locals.t('tracking.title')} | SNG Express`,
  };
}

/**
 * The Thai leg for a quotation: its customer-visible stages plus the box counts.
 * Product name is included (it is the customer's own goods); price, deposit and
 * supplier details are not — those live behind the member login.
 */
async function loadSupplierLeg(quotationId) {
  const [[quotation]] = await pool.query(
    `SELECT id, quote_no, product_name, desired_qty, status, created_at, updated_at
     FROM partner_quotations WHERE id = ?`,
    [quotationId]
  );
  if (!quotation) return null;

  const [logs] = await pool.query(
    `SELECT to_status, action_at FROM partner_quotation_status_logs
     WHERE quotation_id = ? ORDER BY action_at ASC`,
    [quotationId]
  );
  const [parcels] = await pool.query(
    'SELECT status FROM quotation_parcels WHERE quotation_id = ?',
    [quotationId]
  );

  const progress = parcelProgress(parcels);
  return {
    quotation,
    supplierTimeline: buildSupplierTimeline(logs, progress),
    supplierProgress: progress,
  };
}

/**
 * GET /track/:ref — ref is an SNG job number or a purchase-agent quote number.
 */
export async function trackOrder(req, res) {
  const ref = (req.params.ref || '').trim().toUpperCase();

  if (!ref) return res.render('customer/track', emptyView(res));

  try {
    const { order, quotationId } = await resolveTrackingRef(ref);

    const supplier = quotationId ? await loadSupplierLeg(quotationId) : null;

    if (!order && !supplier) {
      return res.render('customer/track', emptyView(res, {
        error: `${res.locals.t('tracking.notFoundPrefix')} "${ref}"`,
      }));
    }

    // Internal notes stay internal even on a page that needs no login.
    const [logs] = order
      ? await pool.query(
          `SELECT to_status, action_at, note
           FROM order_status_logs
           WHERE order_id = ?
             AND note NOT LIKE '%[EXCEPTION]%'
             AND note NOT LIKE '%[INTERNAL]%'
           ORDER BY action_at ASC`,
          [order.id]
        )
      : [[]];

    res.render('customer/track', {
      ...emptyView(res),
      order,
      logs,
      timeline: order ? buildTrackingTimeline(logs, order) : [],
      quotation: supplier?.quotation || null,
      supplierTimeline: supplier?.supplierTimeline || [],
      supplierProgress: supplier?.supplierProgress || null,
      title: `${res.locals.t('tracking.title')} ${order?.job_no || supplier?.quotation.quote_no} | SNG Express`,
    });
  } catch (err) {
    console.error('[Tracking]', err);
    res.render('customer/track', emptyView(res, {
      error: res.locals.t('tracking.systemError'),
    }));
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
  res.render('customer/track', emptyView(res));
}
