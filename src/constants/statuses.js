/**
 * Single source of truth for all order and trip status values.
 * Import this file in any controller that reads/writes status fields.
 *
 * ⚠️ BACKWARD COMPATIBILITY NOTE:
 * เก็บ RECEIVED_WH_TH / RECEIVED_WH_LA ไว้เหมือนเดิม (ไม่ rename)
 * เพราะ database มีข้อมูลเดิมอยู่ — ไม่ break data ที่มีอยู่
 */

// ─── Order Statuses ──────────────────────────────────────────────────────────
export const ORDER_STATUS = {
  NEW:                'NEW',
  RECEIVED_WH_TH:    'RECEIVED_WH_TH',
  RECEIVED_WH_LA:    'RECEIVED_WH_LA',
  ON_TRUCK:           'ON_TRUCK',
  CROSSING_BORDER:   'CROSSING_BORDER',
  CUSTOMS_HOLD:      'CUSTOMS_HOLD',
  CUSTOMS_CLEARED:   'CUSTOMS_CLEARED',
  CUSTOMS_REJECTED:  'CUSTOMS_REJECTED',
  ARRIVED_BORDER_WH: 'ARRIVED_BORDER_WH',
  AT_DEST_WH:        'AT_DEST_WH',
  // ─── Branch Hub last-mile workflow ──────────────────────────────────
  BRANCH_TRANSFER:   'BRANCH_TRANSFER',   // กำลังขนส่งจากคลังใหญ่ไปสาขา
  BRANCH_RECEIVED:   'BRANCH_RECEIVED',   // สาขารับพัสดุแล้ว รอ assign ไรเดอร์
  RIDER_ASSIGNED:    'RIDER_ASSIGNED',    // ไรเดอร์รับงานแล้ว กำลังออกไปรับ
  // ────────────────────────────────────────────────────
  OUT_FOR_DELIVERY:  'OUT_FOR_DELIVERY',
  DELIVERED:         'DELIVERED',
  DELIVERY_FAILED:   'DELIVERY_FAILED',
  COD_COLLECTED:     'COD_COLLECTED',
  COD_REMITTED:      'COD_REMITTED',
  RETURN_TO_SENDER:  'RETURN_TO_SENDER',
  CLOSED:            'CLOSED',
};

// Legacy aliases — ระบบเดิมใช้ชื่อเหล่านี้ ยังรองรับอยู่
export const LEGACY_STATUS_MAP = {
  'ON_TRUCK_BORDER':   ORDER_STATUS.ON_TRUCK,
  'CUSTOMS_CLEARANCE': ORDER_STATUS.CUSTOMS_HOLD,
  'CLEARED':           ORDER_STATUS.CUSTOMS_CLEARED,
  'FAILED':            ORDER_STATUS.DELIVERY_FAILED,
  'RETURNED':          ORDER_STATUS.RETURN_TO_SENDER,
};

// ─── Scanner Allowed Statuses ────────────────────────────────────────────────
/** สถานะที่ scanner/user สามารถ push ได้ผ่าน quick-update */
export const SCANNER_ALLOWED_STATUSES = new Set([
  ORDER_STATUS.RECEIVED_WH_TH,
  ORDER_STATUS.RECEIVED_WH_LA,
  ORDER_STATUS.ON_TRUCK,
  ORDER_STATUS.CROSSING_BORDER,
  ORDER_STATUS.ARRIVED_BORDER_WH,
  ORDER_STATUS.AT_DEST_WH,
  ORDER_STATUS.OUT_FOR_DELIVERY,
  ORDER_STATUS.DELIVERED,
]);

// ─── Trip Statuses ───────────────────────────────────────────────────────────
export const TRIP_STATUS = {
  PLANNED:   'PLANNED',
  LOADING:   'LOADING',
  DEPARTED:  'DEPARTED',
  AT_BORDER: 'AT_BORDER',
  CROSSED:   'CROSSED',
  ARRIVED:   'ARRIVED',
  UNLOADING: 'UNLOADING',
  COMPLETED: 'COMPLETED',  // v2: replaces CLOSED
  CANCELLED: 'CANCELLED',
  // Backward compat alias — do not write to DB with this value
  CLOSED:    'COMPLETED',
};

// ─── Thai Labels + CSS Classes ───────────────────────────────────────────────
export const ORDER_STATUS_LABELS = {
  [ORDER_STATUS.NEW]:                { label: 'ใหม่',              cssClass: 'new' },
  [ORDER_STATUS.RECEIVED_WH_TH]:    { label: 'รับที่คลังไทย',     cssClass: 'received' },
  [ORDER_STATUS.RECEIVED_WH_LA]:    { label: 'รับที่คลังลาว',     cssClass: 'received' },
  [ORDER_STATUS.ON_TRUCK]:           { label: 'ขึ้นรถ',             cssClass: 'transit' },
  [ORDER_STATUS.CROSSING_BORDER]:   { label: 'ข้ามแดน',            cssClass: 'crossing' },
  [ORDER_STATUS.CUSTOMS_HOLD]:      { label: 'รอศุลกากร',         cssClass: 'customs' },
  [ORDER_STATUS.CUSTOMS_CLEARED]:   { label: 'ผ่านศุลกากร',       cssClass: 'transit' },
  [ORDER_STATUS.CUSTOMS_REJECTED]:  { label: 'ศุลกากรกัก',        cssClass: 'failed' },
  [ORDER_STATUS.ARRIVED_BORDER_WH]: { label: 'ถึงคลังชายแดน',     cssClass: 'transit' },
  [ORDER_STATUS.AT_DEST_WH]:        { label: 'ถึงคลังปลายทาง',    cssClass: 'warehouse' },
  // Branch Hub statuses
  [ORDER_STATUS.BRANCH_TRANSFER]:   { label: 'ส่งไปสาขา',          cssClass: 'transit' },
  [ORDER_STATUS.BRANCH_RECEIVED]:   { label: 'สาขารับแล้ว',        cssClass: 'warehouse' },
  [ORDER_STATUS.RIDER_ASSIGNED]:    { label: 'ไรเดอร์รับงาน',       cssClass: 'delivery' },
  [ORDER_STATUS.OUT_FOR_DELIVERY]:  { label: 'กำลังส่ง',           cssClass: 'delivery' },
  [ORDER_STATUS.DELIVERED]:         { label: 'ส่งสำเร็จ',          cssClass: 'completed' },
  [ORDER_STATUS.DELIVERY_FAILED]:   { label: 'ส่งไม่สำเร็จ',      cssClass: 'failed' },
  [ORDER_STATUS.COD_COLLECTED]:     { label: 'เก็บ COD แล้ว',     cssClass: 'completed' },
  [ORDER_STATUS.COD_REMITTED]:      { label: 'โอน COD แล้ว',     cssClass: 'completed' },
  [ORDER_STATUS.RETURN_TO_SENDER]:  { label: 'คืนผู้ส่ง',          cssClass: 'failed' },
  [ORDER_STATUS.CLOSED]:            { label: 'ปิดงาน',             cssClass: 'closed' },
};

// ─── In-Transit Statuses (สำหรับ KPI) ────────────────────────────────────────
export const IN_TRANSIT_STATUSES = [
  ORDER_STATUS.RECEIVED_WH_TH,
  ORDER_STATUS.RECEIVED_WH_LA,
  ORDER_STATUS.ON_TRUCK,
  ORDER_STATUS.CROSSING_BORDER,
  ORDER_STATUS.CUSTOMS_HOLD,
  ORDER_STATUS.CUSTOMS_CLEARED,
  ORDER_STATUS.ARRIVED_BORDER_WH,
  ORDER_STATUS.AT_DEST_WH,
  // Branch Hub last-mile
  ORDER_STATUS.BRANCH_TRANSFER,
  ORDER_STATUS.BRANCH_RECEIVED,
  ORDER_STATUS.RIDER_ASSIGNED,
  ORDER_STATUS.OUT_FOR_DELIVERY,
];

// ─── Delivery Failure Reasons ────────────────────────────────────────────────
export const DELIVERY_FAIL_REASONS = [
  'NO_ONE_HOME',
  'WRONG_ADDRESS',
  'REFUSED',
  'PHONE_UNREACHABLE',
  'ROAD_INACCESSIBLE',
  'OTHER',
];

// ─── Trip Status Labels ──────────────────────────────────────────────────────
export const TRIP_STATUS_LABELS = {
  PLANNED:   { label: 'วางแผน',        cssClass: 'new' },
  LOADING:   { label: 'กำลังโหลด',     cssClass: 'transit' },
  DEPARTED:  { label: 'ออกเดินทาง',    cssClass: 'transit' },
  AT_BORDER: { label: 'ถึงด่าน',        cssClass: 'crossing' },
  CROSSED:   { label: 'ผ่านด่าน',       cssClass: 'transit' },
  ARRIVED:   { label: 'ถึงปลายทาง',    cssClass: 'completed' },
  UNLOADING: { label: 'กำลังลงสินค้า', cssClass: 'transit' },
  COMPLETED: { label: 'ปิดรอบแล้ว',    cssClass: 'closed' },
  CANCELLED: { label: 'ยกเลิก',         cssClass: 'failed' },
  // Backward compat
  CLOSED:    { label: 'ปิดรอบ',         cssClass: 'closed' },
};
