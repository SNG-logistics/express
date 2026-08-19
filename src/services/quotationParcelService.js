/**
 * quotationParcelService.js — the boxes a purchase-agent order arrives in.
 *
 * One Lazada order routinely splits into several parcels, shipped on different
 * days by different couriers, so progress on the Thai leg is a count rather than
 * a single state: "2 of 3 boxes have reached the SNG warehouse".
 *
 * The tracking numbers stored here are staff-only. Customers see how far their
 * goods have got and how many boxes have landed — never the number or the shop
 * it came from — while SNG still needs the number to chase a late parcel and to
 * answer someone asking on WhatsApp.
 */
import pool from '../config/db.js';
import { WorkflowError } from './orderWorkflowService.js';

export const PARCEL_STATUSES = ['PENDING', 'SHIPPED', 'AT_TH_HUB', 'LOST'];

/** Timestamp column each status stamps when a parcel reaches it. */
const STATUS_STAMPS = {
  SHIPPED: 'shipped_at',
  AT_TH_HUB: 'arrived_th_hub_at',
};

export async function listParcels(quotationId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT * FROM quotation_parcels WHERE quotation_id = ? ORDER BY parcel_seq ASC`,
    [quotationId]
  );
  return rows;
}

/**
 * Where the Thai leg as a whole has got to, derived from the boxes rather than
 * set by hand — a quotation is only as far along as its slowest parcel.
 *
 * Lost parcels are excluded from the "all arrived" test on purpose: without
 * that, one box going missing would hold the entire order open forever, when
 * what the business actually does is claim for it and carry on with the rest.
 * An order where every box is lost stays at `purchased`, since nothing has
 * arrived and the order plainly is not ready to cross the border.
 *
 * @param {Array<{status:string}>} parcels
 * @returns {'purchased'|'supplier_shipped'|'at_th_hub'}
 */
export function deriveSupplierStage(parcels) {
  const live = (parcels || []).filter(p => p.status !== 'LOST');
  if (live.length === 0) return 'purchased';
  if (live.every(p => p.status === 'AT_TH_HUB')) return 'at_th_hub';
  if (live.some(p => p.status === 'SHIPPED' || p.status === 'AT_TH_HUB')) return 'supplier_shipped';
  return 'purchased';
}

/**
 * The counts the customer-facing line is written from, e.g.
 * "ถึงคลัง SNG แล้ว 2 จาก 3 กล่อง". `expected` excludes lost boxes so the
 * denominator matches what can still turn up.
 */
export function parcelProgress(parcels) {
  const all = parcels || [];
  const lost = all.filter(p => p.status === 'LOST').length;
  return {
    total: all.length,
    expected: all.length - lost,
    shipped: all.filter(p => p.status === 'SHIPPED').length,
    arrived: all.filter(p => p.status === 'AT_TH_HUB').length,
    lost,
  };
}

/** Next free box number for a quotation, so staff never pick one by hand. */
async function nextSeq(quotationId, conn) {
  const [[row]] = await conn.query(
    'SELECT COALESCE(MAX(parcel_seq), 0) AS max_seq FROM quotation_parcels WHERE quotation_id = ?',
    [quotationId]
  );
  return Number(row.max_seq) + 1;
}

export async function addParcel(quotationId, fields, userId = null, conn = pool) {
  const [[quotation]] = await conn.query(
    'SELECT id FROM partner_quotations WHERE id = ?', [quotationId]
  );
  if (!quotation) throw new WorkflowError('ไม่พบใบเสนอราคานี้', 404);

  const status = normaliseStatus(fields.status);
  const seq = await nextSeq(quotationId, conn);

  const [result] = await conn.query(
    `INSERT INTO quotation_parcels
       (quotation_id, parcel_seq, supplier_courier, supplier_tracking_no,
        item_note, status, shipped_at, arrived_th_hub_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      quotationId, seq,
      trimOrNull(fields.supplier_courier),
      trimOrNull(fields.supplier_tracking_no),
      trimOrNull(fields.item_note),
      status,
      status === 'SHIPPED' || status === 'AT_TH_HUB' ? new Date() : null,
      status === 'AT_TH_HUB' ? new Date() : null,
      userId,
    ]
  );
  return { id: result.insertId, parcel_seq: seq };
}

/**
 * Update one box. A status change stamps its timestamp the first time the box
 * reaches that stage and leaves it alone afterwards — re-saving a form should
 * not rewrite when the goods actually shipped.
 */
export async function updateParcel(parcelId, quotationId, fields, conn = pool) {
  const [[parcel]] = await conn.query(
    'SELECT * FROM quotation_parcels WHERE id = ? AND quotation_id = ?',
    [parcelId, quotationId]
  );
  if (!parcel) throw new WorkflowError('ไม่พบพัสดุนี้', 404);

  const status = normaliseStatus(fields.status ?? parcel.status);
  const stamps = {};
  for (const [stage, column] of Object.entries(STATUS_STAMPS)) {
    const reached = status === stage
      || (stage === 'SHIPPED' && status === 'AT_TH_HUB'); // arriving implies it shipped
    if (reached && !parcel[column]) stamps[column] = new Date();
  }

  await conn.query(
    `UPDATE quotation_parcels
        SET supplier_courier = ?, supplier_tracking_no = ?, item_note = ?, status = ?,
            shipped_at = ?, arrived_th_hub_at = ?
      WHERE id = ? AND quotation_id = ?`,
    [
      trimOrNull(fields.supplier_courier ?? parcel.supplier_courier),
      trimOrNull(fields.supplier_tracking_no ?? parcel.supplier_tracking_no),
      trimOrNull(fields.item_note ?? parcel.item_note),
      status,
      stamps.shipped_at ?? parcel.shipped_at,
      stamps.arrived_th_hub_at ?? parcel.arrived_th_hub_at,
      parcelId, quotationId,
    ]
  );
  return { updated: true, status };
}

export async function deleteParcel(parcelId, quotationId, conn = pool) {
  const [result] = await conn.query(
    'DELETE FROM quotation_parcels WHERE id = ? AND quotation_id = ?',
    [parcelId, quotationId]
  );
  if (result.affectedRows === 0) throw new WorkflowError('ไม่พบพัสดุนี้', 404);
  return { deleted: true };
}

/**
 * Statuses whose position on the Thai leg is owned by the parcels. Outside this
 * band the quotation is either not there yet (`purchasing` and earlier) or past
 * it (`ordered`, `cancelled`) and a parcel edit must not drag it back.
 */
const PARCEL_DRIVEN_STATUSES = new Set(['purchased', 'supplier_shipped', 'at_th_hub']);

/**
 * Push the quotation to whatever stage its boxes now imply.
 *
 * Called after any parcel is added, edited or removed. Staff never pick these
 * statuses themselves — recording that a box shipped IS the status change, so
 * there is no second screen to remember and no way for the two to disagree.
 *
 * @returns {Promise<{changed:boolean, from?:string, to?:string, reason?:string}>}
 */
export async function syncQuotationStage(quotationId, userId = null) {
  const [[quotation]] = await pool.query(
    'SELECT id, status FROM partner_quotations WHERE id = ?', [quotationId]
  );
  if (!quotation) return { changed: false, reason: 'NOT_FOUND' };
  if (!PARCEL_DRIVEN_STATUSES.has(quotation.status)) {
    return { changed: false, reason: 'STAGE_NOT_PARCEL_DRIVEN' };
  }

  const parcels = await listParcels(quotationId);
  const target = deriveSupplierStage(parcels);
  if (target === quotation.status) return { changed: false, reason: 'ALREADY_THERE' };

  const progress = parcelProgress(parcels);
  const { transitionQuotation } = await import('./quotationWorkflowService.js');
  await transitionQuotation({
    quotationId,
    toStatus: target,
    userId,
    note: `[PARCELS] ${progress.arrived}/${progress.expected} กล่องถึงคลังไทย`,
    // Only tell the customer about forward progress. Walking the stage back to
    // correct a mis-marked box is bookkeeping, and messaging them "your goods
    // have un-arrived" would do nothing but alarm them.
    notify: isForward(quotation.status, target),
    extraPayload: {
      shipped: progress.shipped + progress.arrived,
      arrived: progress.arrived,
      expected: progress.expected,
    },
  });
  return { changed: true, from: quotation.status, to: target };
}

const STAGE_ORDER = ['purchased', 'supplier_shipped', 'at_th_hub'];
function isForward(from, to) {
  return STAGE_ORDER.indexOf(to) > STAGE_ORDER.indexOf(from);
}

function normaliseStatus(raw) {
  const status = String(raw || 'PENDING').toUpperCase();
  if (!PARCEL_STATUSES.includes(status)) {
    throw new WorkflowError(`สถานะพัสดุไม่ถูกต้อง: ${raw}`, 400);
  }
  return status;
}

function trimOrNull(value) {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}
