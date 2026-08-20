/**
 * src/routes/orders.js — Order routes with role-based access control
 *
 * Access control matrix:
 * ┌─────────────────────────────────┬───────────────────────────────────────────┐
 * │ Action                          │ Roles Allowed                             │
 * ├─────────────────────────────────┼───────────────────────────────────────────┤
 * │ View/list orders                │ All authenticated                         │
 * │ Create order                    │ admin, manager, dispatcher, warehouse, staff│
 * │ Edit order                      │ admin, manager, dispatcher                │
 * │ Print waybill                   │ All authenticated                         │
 * │ Receive at warehouse            │ admin, manager, dispatcher, warehouse_th  │
 * │ Start crossing / border moves   │ admin, manager, dispatcher                │
 * │ Arrive dest warehouse           │ admin, manager, dispatcher, warehouse_la  │
 * │ Start delivery / mark delivered │ admin, manager, dispatcher                │
 * │ Retry a failed delivery         │ admin, manager, dispatcher, driver_support, branch_operator │
 * │ Release a stuck rider job       │ admin, manager, dispatcher                │
 * │ Return to sender (destructive)  │ admin, manager, dispatcher                │
 * │ Close order (irreversible)      │ admin, manager only                       │
 * │ Add payment/expense             │ admin, manager, finance, dispatcher       │
 * │ Delete payment (destructive)    │ admin, manager, finance only              │
 * │ Delete order (permanent)        │ owner only — test-data cleanup            │
 * └─────────────────────────────────┴───────────────────────────────────────────┘
 */
import { Router } from 'express';
import * as orders   from '../controllers/ordersController.js';
import * as payments from '../controllers/paymentsController.js';
import * as customers from '../controllers/customersController.js';
import {
  requireLogin,
  requireRole,
  ROLES_ORDER_WRITE,
  ROLES_WAREHOUSE,
  ROLES_FINANCE,
  ROLES_RETURN_ORDER,
  ROLES_CLOSE_ORDER,
  ROLES_DELIVERY_WRITE,
  ROLES_RIDER_REASSIGN,
  ROLES_READ,
} from '../middleware/auth.js';
import upload from '../config/upload.js';

const router = Router();

// ─── Customer APIs (order form autocomplete + phone lookup) ──────────────────
router.get('/api/customers/search',      requireLogin, requireRole(ROLES_READ), customers.search);
router.get('/api/customers/lookup',      requireLogin, requireRole(ROLES_READ), customers.phoneLookup);  // ?phone=0812345678

// ─── Order creation (must be BEFORE /orders/:id) ────────────────────────────
router.get('/orders/new',     requireLogin, requireRole(ROLES_ORDER_WRITE), orders.showCreate);
router.post('/orders',        requireLogin, requireRole(ROLES_ORDER_WRITE),
  upload.single('parcel_image'), orders.create);

// ─── Order scan (must be BEFORE /orders/:id) ─────────────────────────────────
router.get('/orders/scan',    requireLogin, requireRole(ROLES_WAREHOUSE), orders.showScan);
router.post('/orders/scan',   requireLogin, requireRole(ROLES_WAREHOUSE), orders.processScan);

// ─── Order list & detail (all authenticated) ─────────────────────────────
router.get('/orders',             requireLogin, requireRole(ROLES_READ), orders.list);
router.get('/orders/:id',         requireLogin, requireRole(ROLES_READ), orders.detail);
router.get('/orders/:id/waybill', requireLogin, requireRole(ROLES_READ), orders.printWaybill);
router.get('/orders/:id/print',   requireLogin, requireRole(ROLES_READ), orders.showPrint);

// ─── Order edit (dispatcher + manager can edit) ───────────────────────────────
router.get('/orders/:id/edit',  requireLogin, requireRole(['admin','manager','dispatcher']), orders.showEdit);
router.post('/orders/:id/edit', requireLogin, requireRole(['admin','manager','dispatcher']), orders.update);

// ─── Status transitions — role-specific ───────────────────────────────────────

// Receive at TH warehouse (TH warehouse staff + dispatcher + manager)
router.post('/orders/:id/receive',
  requireLogin, requireRole(['admin','manager','dispatcher','warehouse_th']),
  orders.receiveOrder);

// Crossing + border movements (dispatchers who plan trips)
router.post('/orders/:id/crossing',
  requireLogin, requireRole(['admin','manager','dispatcher']),
  orders.startCrossing);

router.post('/orders/:id/arrived-border',
  requireLogin, requireRole(['admin','manager','dispatcher']),
  orders.arriveBorder);

// Arrive at Lao destination warehouse
router.post('/orders/:id/arrived-dest',
  requireLogin, requireRole(['admin','manager','dispatcher','warehouse_la']),
  orders.arriveDestinationWh);

// Destination-office completion options (order arrived at Lao warehouse):
//   ลงสาขา / ลูกค้ามารับที่สำนักงาน / ส่งต่อขนส่งเจ้าอื่น
const ROLES_DEST_OFFICE = ['admin', 'manager', 'dispatcher', 'warehouse_la', 'branch_operator'];
router.post('/orders/:id/to-branch',
  requireLogin, requireRole(ROLES_DEST_OFFICE),
  orders.sendToBranch);
router.post('/orders/:id/pickup-at-office',
  requireLogin, requireRole(ROLES_DEST_OFFICE),
  orders.pickupAtOffice);
router.post('/orders/:id/forward',
  requireLogin, requireRole(ROLES_DEST_OFFICE),
  orders.forwardThirdParty);

// Start delivery + mark delivered (dispatcher + driver support)
router.post('/orders/:id/delivery',
  requireLogin, requireRole(ROLES_DELIVERY_WRITE),
  orders.startDelivery);

router.post('/orders/:id/delivered',
  requireLogin, requireRole(ROLES_DELIVERY_WRITE),
  upload.single('pod_image'),
  orders.markDelivered);

router.post('/orders/:id/delivery-failed',
  requireLogin, requireRole(ROLES_DELIVERY_WRITE),
  orders.markDeliveryFailed);

// Retry a failed delivery — same gate as starting/completing delivery above,
// since this is fixing that same action's broken "ส่งใหม่" button, not adding
// a new capability.
router.post('/orders/:id/delivery-retry',
  requireLogin, requireRole(ROLES_DELIVERY_WRITE),
  orders.retryFailedDelivery);

// Release a stuck rider job — a genuinely new capability, so central-dispatch
// only rather than matching the broader ROLES_DELIVERY_WRITE above.
router.post('/orders/:id/release-rider',
  requireLogin, requireRole(ROLES_RIDER_REASSIGN),
  orders.releaseRiderAssignment);

// ─── Destructive / irreversible actions ───────────────────────────────────────

// Return to sender — needs manager sign-off
router.post('/orders/:id/return',
  requireLogin, requireRole(ROLES_RETURN_ORDER),
  orders.returnToSender);

// Close order — admin/manager only (irreversible)
router.post('/orders/:id/close',
  requireLogin, requireRole(ROLES_CLOSE_ORDER),
  orders.closeOrder);

// Delete order — OWNER ONLY, permanent (test-data cleanup; not for production use)
router.post('/orders/:id/delete',
  requireLogin, requireRole(['owner']),
  orders.deleteOrder);

// ─── Phase 2: Warehouse Screening ─────────────────────────────────────────────

// Screen an order (pass/flag/reject)
router.post('/orders/:id/screen',
  requireLogin, requireRole(['admin','manager','dispatcher','warehouse_th']),
  orders.screenOrder);

// Print sticker (marks sticker_printed_at)
router.post('/orders/:id/print-sticker',
  requireLogin, requireRole(['admin','manager','dispatcher','warehouse_th']),
  orders.printSticker);

// Get sticker HTML (for thermal printer)
router.get('/orders/:id/sticker',
  requireLogin, requireRole(ROLES_READ),
  orders.showSticker);

// Resolve a single order flag
router.post('/orders/:id/flags/:flagId/resolve',
  requireLogin, requireRole(['admin','manager','dispatcher','warehouse_th']),
  orders.resolveFlag);

// ─── Payments / Expenses ──────────────────────────────────────────────────────

// Add payment (finance + dispatcher)
router.post('/orders/:id/payments',
  requireLogin, requireRole([...ROLES_FINANCE, 'dispatcher']),
  payments.addPayment);

// Delete payment — finance/manager only (affects P&L)
router.post('/orders/:id/payments/:paymentId/delete',
  requireLogin, requireRole(ROLES_FINANCE),
  payments.deletePayment);

export default router;
