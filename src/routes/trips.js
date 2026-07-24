import { Router } from 'express';
import * as trips from '../controllers/tripsController.js';
import {
  requireLogin,
  requireRole,
  ROLES_MANAGE,
  ROLES_FINANCE,
  ROLES_ADMIN_ONLY,
} from '../middleware/auth.js';

const ROLES_DISPATCHER = ['admin', 'manager', 'dispatcher'];

const router = Router();

router.get('/trips',                    requireLogin,                                    trips.list);
router.get('/trips/new',                requireLogin, requireRole(ROLES_DISPATCHER),    trips.showCreate);
router.post('/trips',                   requireLogin, requireRole(ROLES_DISPATCHER),    trips.create);
router.post('/trips/:id/settle',        requireLogin, requireRole(ROLES_FINANCE),       trips.settleTrip);

// Specific routes BEFORE generic :id route
router.post('/trips/:id/update-status', requireLogin, requireRole(ROLES_DISPATCHER),   trips.updateStatus);
router.post('/trips/:id/orders',        requireLogin, requireRole(ROLES_DISPATCHER),   trips.attachOrders);
router.get('/trips/:id/manifest',       requireLogin,                                   trips.printManifest);
router.get('/trips/:id/expenses/print', requireLogin,                                   trips.printExpenses);

router.post('/trips/:id/orders/:orderId/detach', requireLogin, requireRole(ROLES_DISPATCHER), trips.detachOrder);

router.post('/trips/:id/edit',          requireLogin, requireRole(ROLES_DISPATCHER),   trips.quickEdit);

// ─── Cancel trip: admin only ──────────────────────────────────────────────────
router.post('/trips/:id/cancel',        requireLogin, requireRole(ROLES_ADMIN_ONLY),   trips.cancelTrip);

// ─── API: active trips for scanner handoff picker ────────────────────────────
router.get('/api/trips/active',         requireLogin, requireRole(ROLES_DISPATCHER), trips.apiActiveTrips);
router.get('/api/trips/arriving',       requireLogin, requireRole(ROLES_DISPATCHER), trips.apiArrivingTrips);

// Generic :id route LAST
router.get('/trips/:id',                requireLogin,                                   trips.detail);

export default router;

