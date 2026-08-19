/**
 * trackingSteps.js — how each order status is presented on the public tracking
 * timeline.
 *
 * Presentation metadata only: which icon stands for a step and whether it reads
 * as normal progress, a finished delivery, or something the customer needs to
 * worry about. The wording lives in the i18n files (`trackStep.<STATUS>`) so
 * Thai and Lao stay translatable; only the parts that are the same in every
 * language belong here.
 */

/** Font Awesome class per status. */
const STEP_ICONS = {
  NEW:                        'fa-solid fa-box',
  RECEIVED_WH_TH:             'fa-solid fa-warehouse',
  RECEIVED_WH_LA:             'fa-solid fa-warehouse',
  READY_TO_LOAD:              'fa-solid fa-boxes-packing',
  ON_TRUCK:                   'fa-solid fa-truck',
  CROSSING_BORDER:            'fa-solid fa-road',
  CUSTOMS_HOLD:               'fa-solid fa-magnifying-glass',
  PENDING_CUSTOMS:            'fa-solid fa-magnifying-glass',
  CUSTOMS_CLEARED:            'fa-solid fa-stamp',
  CUSTOMS_REJECTED:           'fa-solid fa-triangle-exclamation',
  SCREENING_FAILED:           'fa-solid fa-triangle-exclamation',
  ARRIVED_BORDER_WH:          'fa-solid fa-flag',
  AT_DEST_WH:                 'fa-solid fa-warehouse',
  BRANCH_TRANSFER:            'fa-solid fa-shuffle',
  BRANCH_RECEIVED:            'fa-solid fa-store',
  RIDER_ASSIGNED:             'fa-solid fa-motorcycle',
  RIDER_ACCEPTED:             'fa-solid fa-motorcycle',
  OUT_FOR_DELIVERY:           'fa-solid fa-motorcycle',
  DELIVERED:                  'fa-solid fa-circle-check',
  DELIVERY_FAILED:            'fa-solid fa-circle-exclamation',
  RETURNED:                   'fa-solid fa-rotate-left',
  RETURN_TO_SENDER:           'fa-solid fa-rotate-left',
  COD_COLLECTED:              'fa-solid fa-hand-holding-dollar',
  COD_REMITTED:               'fa-solid fa-hand-holding-dollar',
  CANCELLED:                  'fa-solid fa-ban',
  CLOSED:                     'fa-solid fa-flag-checkered',
};

const FALLBACK_ICON = 'fa-solid fa-circle-dot';

/**
 * Statuses where something went wrong and the customer may need to act or wait
 * for a call. These get the alert treatment rather than the neutral one, so a
 * failed delivery is never just another grey line in a list.
 */
const PROBLEM_STATUSES = new Set([
  'DELIVERY_FAILED', 'CUSTOMS_REJECTED', 'SCREENING_FAILED',
  'RETURNED', 'RETURN_TO_SENDER', 'CANCELLED',
]);

/** Statuses that mean the parcel is in the customer's hands, or accounted for. */
const SUCCESS_STATUSES = new Set(['DELIVERED', 'COD_COLLECTED', 'COD_REMITTED', 'CLOSED']);

export function stepIcon(status) {
  return STEP_ICONS[status] || FALLBACK_ICON;
}

/**
 * @returns {'problem'|'success'|'normal'} which visual treatment a step gets.
 */
export function stepTone(status) {
  if (PROBLEM_STATUSES.has(status)) return 'problem';
  if (SUCCESS_STATUSES.has(status)) return 'success';
  return 'normal';
}

/**
 * Build the timeline the customer reads, newest first.
 *
 * Newest-first matters: someone opening this page wants "where is it now",
 * which should be the first thing under their thumb rather than the last thing
 * after scrolling past a week of history.
 *
 * The first entry is marked `current` — the tracking page highlights it and
 * greys the rest, so the live step is findable at a glance instead of the
 * reader having to compare timestamps.
 *
 * @param {Array<{to_status:string, action_at:Date|string, note?:string}>} logs
 *   status history, oldest first (the order trackingController queries in)
 * @param {{status:string, created_at:Date|string}} order
 *   used only to synthesise a single entry when an order has no history yet
 * @returns {Array<{status:string, at:Date|string, icon:string, tone:string, current:boolean}>}
 */
export function buildTrackingTimeline(logs, order) {
  const entries = (logs || []).map(log => ({
    status: log.to_status,
    at: log.action_at,
    note: log.note || null,
  }));

  // A freshly created order has no log rows yet; showing an empty timeline
  // would read as "we have no idea where your parcel is".
  if (entries.length === 0 && order) {
    entries.push({ status: order.status, at: order.created_at, note: null });
  }

  return entries
    .slice()
    .reverse()
    .map((entry, index) => ({
      ...entry,
      icon: stepIcon(entry.status),
      tone: stepTone(entry.status),
      current: index === 0,
    }));
}
