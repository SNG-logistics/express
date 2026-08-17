/**
 * Order & Trip transition rules.
 * canTransition(from, to) — ตรวจสอบว่าอนุญาตให้เปลี่ยนสถานะได้หรือไม่
 * resolveStatus(raw)      — แปลง status เดิม (legacy) เป็นชื่อใหม่
 */
import { ORDER_STATUS, TRIP_STATUS, LEGACY_STATUS_MAP } from './statuses.js';

// ─── Order Allowed Transitions ───────────────────────────────────────────────
const ORDER_TRANSITIONS = {
  [ORDER_STATUS.NEW]:                [ORDER_STATUS.RECEIVED_WH_TH, ORDER_STATUS.RECEIVED_WH_LA],
  [ORDER_STATUS.RECEIVED_WH_TH]:    [ORDER_STATUS.ON_TRUCK],
  [ORDER_STATUS.RECEIVED_WH_LA]:    [ORDER_STATUS.ON_TRUCK],
  [ORDER_STATUS.ON_TRUCK]:           [ORDER_STATUS.CROSSING_BORDER],
  [ORDER_STATUS.CROSSING_BORDER]:   [ORDER_STATUS.CUSTOMS_HOLD, ORDER_STATUS.ARRIVED_BORDER_WH],
  [ORDER_STATUS.CUSTOMS_HOLD]:      [ORDER_STATUS.CUSTOMS_CLEARED, ORDER_STATUS.CUSTOMS_REJECTED],
  [ORDER_STATUS.CUSTOMS_CLEARED]:   [ORDER_STATUS.ARRIVED_BORDER_WH],
  [ORDER_STATUS.CUSTOMS_REJECTED]:  [ORDER_STATUS.CLOSED],
  [ORDER_STATUS.ARRIVED_BORDER_WH]: [ORDER_STATUS.AT_DEST_WH],
  [ORDER_STATUS.AT_DEST_WH]:        [
    ORDER_STATUS.OUT_FOR_DELIVERY,
    ORDER_STATUS.BRANCH_TRANSFER,   // last-mile via branch hub
    ORDER_STATUS.DELIVERED,         // customer self-pickup OR forwarded to a 3rd-party courier
    ORDER_STATUS.RIDER_ASSIGNED,    // HQ rider claims directly — no branch hop, order never leaves the main warehouse
  ],
  [ORDER_STATUS.BRANCH_TRANSFER]:   [ORDER_STATUS.BRANCH_RECEIVED],
  [ORDER_STATUS.BRANCH_RECEIVED]:   [ORDER_STATUS.RIDER_ASSIGNED],
  [ORDER_STATUS.RIDER_ASSIGNED]:    [ORDER_STATUS.RIDER_ACCEPTED, ORDER_STATUS.OUT_FOR_DELIVERY],
  [ORDER_STATUS.RIDER_ACCEPTED]:    [ORDER_STATUS.OUT_FOR_DELIVERY],
  [ORDER_STATUS.OUT_FOR_DELIVERY]:  [ORDER_STATUS.DELIVERED, ORDER_STATUS.DELIVERY_FAILED],
  [ORDER_STATUS.DELIVERED]:         [ORDER_STATUS.COD_COLLECTED, ORDER_STATUS.CLOSED],
  [ORDER_STATUS.DELIVERY_FAILED]:   [ORDER_STATUS.AT_DEST_WH, ORDER_STATUS.RETURN_TO_SENDER],
  [ORDER_STATUS.COD_COLLECTED]:     [ORDER_STATUS.COD_REMITTED],
  [ORDER_STATUS.COD_REMITTED]:      [ORDER_STATUS.CLOSED],
  [ORDER_STATUS.RETURN_TO_SENDER]:  [ORDER_STATUS.CLOSED],
  [ORDER_STATUS.CLOSED]:            [],
};

// ─── Trip Allowed Transitions ────────────────────────────────────────────────
const TRIP_TRANSITIONS = {
  [TRIP_STATUS.PLANNED]:   [TRIP_STATUS.LOADING, TRIP_STATUS.CANCELLED],
  [TRIP_STATUS.LOADING]:   [TRIP_STATUS.DEPARTED, TRIP_STATUS.PLANNED, TRIP_STATUS.CANCELLED],
  [TRIP_STATUS.DEPARTED]:  [TRIP_STATUS.AT_BORDER],
  [TRIP_STATUS.AT_BORDER]: [TRIP_STATUS.CROSSED],
  [TRIP_STATUS.CROSSED]:   [TRIP_STATUS.ARRIVED],
  [TRIP_STATUS.ARRIVED]:   [TRIP_STATUS.UNLOADING],
  [TRIP_STATUS.UNLOADING]: [TRIP_STATUS.COMPLETED],
  [TRIP_STATUS.COMPLETED]: [],
  [TRIP_STATUS.CANCELLED]: [],
  // Backward compat — trips with legacy status 'CLOSED' in DB treat as terminal
  'CLOSED':                [],
};

// ─── Quotation Allowed Transitions (Purchase-Agent, Phase 3.x) ───────────────
// Same shape as the order/trip machines. `accepted → purchasing` is additionally
// gated at the service layer on payment_status === 'PAID' (deposit covered) —
// the graph below only encodes the status relationship itself.
const QUOTATION_TRANSITIONS = {
  draft:       ['sent', 'cancelled'],
  sent:        ['accepted', 'rejected', 'cancelled'],
  accepted:    ['purchasing', 'cancelled'],
  purchasing:  ['purchased', 'cancelled'],
  purchased:   ['ordered', 'cancelled'],
  rejected:    [],
  ordered:     [],
  cancelled:   [],
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * ตรวจสอบว่า order สามารถเปลี่ยนจาก `from` ไป `to` ได้หรือไม่
 * @param {string} from - สถานะปัจจุบัน
 * @param {string} to   - สถานะที่ต้องการเปลี่ยนไป
 * @returns {boolean}
 */
export function canTransitionOrder(from, to) {
  const normalizedFrom = resolveStatus(from);
  const normalizedTo = resolveStatus(to);
  // READY_TO_LOAD was written by an older screening flow. Screening is now
  // orthogonal to logistics status, but legacy rows must still be loadable.
  if (from === 'READY_TO_LOAD') return normalizedTo === ORDER_STATUS.ON_TRUCK;
  const allowed = ORDER_TRANSITIONS[normalizedFrom];
  if (!allowed) return false;
  return allowed.includes(normalizedTo);
}

/**
 * ตรวจสอบว่า trip สามารถเปลี่ยนจาก `from` ไป `to` ได้หรือไม่
 */
export function canTransitionTrip(from, to) {
  const allowed = TRIP_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * ตรวจสอบว่า quotation (ใบเสนอราคา purchase-agent) สามารถเปลี่ยนจาก `from`
 * ไป `to` ได้หรือไม่ ตาม QUOTATION_TRANSITIONS ข้างต้น
 */
export function canTransitionQuotation(from, to) {
  const allowed = QUOTATION_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * ดึงรายการสถานะถัดไปที่อนุญาตของ order
 * @param {string} currentStatus
 * @returns {string[]}
 */
export function getNextOrderStatuses(currentStatus) {
  return ORDER_TRANSITIONS[currentStatus] || [];
}

/**
 * ดึงรายการสถานะถัดไปที่อนุญาตของ trip
 */
export function getNextTripStatuses(currentStatus) {
  return TRIP_TRANSITIONS[currentStatus] || [];
}

/**
 * ดึงรายการสถานะถัดไปที่อนุญาตของ quotation
 */
export function getNextQuotationStatuses(currentStatus) {
  return QUOTATION_TRANSITIONS[currentStatus] || [];
}

/**
 * แปลง status เก่า → ชื่อใหม่ (backward compat)
 * ถ้าไม่ใช่ legacy status → คืนค่าเดิม
 * @param {string} raw
 * @returns {string}
 */
export function resolveStatus(raw) {
  return Object.prototype.hasOwnProperty.call(LEGACY_STATUS_MAP, raw)
    ? LEGACY_STATUS_MAP[raw]
    : raw;
}

export const ORDER_TRANSITION_RULES = Object.freeze(ORDER_TRANSITIONS);
export const TRIP_TRANSITION_RULES = Object.freeze(TRIP_TRANSITIONS);
export const QUOTATION_TRANSITION_RULES = Object.freeze(QUOTATION_TRANSITIONS);

/**
 * ตรวจสอบว่า order ปิดการทำงาน COD ครบแล้วหรือไม่ ก่อนจะ CLOSE ได้
 * @param {object} order - order row จาก DB
 * @param {string|null} codStatus - cod_settlements.status (หรือ null ถ้าไม่มี)
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canCloseOrder(order, codStatus) {
  // ถ้ามี COD → ต้อง REMITTED ก่อน
  if (order.cod_amount > 0) {
    if (codStatus !== 'REMITTED') {
      return { ok: false, reason: 'ยังไม่ได้โอนเงิน COD คืนลูกค้า (ต้อง Remit ก่อน)' };
    }
  }
  return { ok: true };
}
