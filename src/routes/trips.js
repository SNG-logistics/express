/**
 * src/routes/trips.js — Trip planning routes with role guards
 *
 * Access control:
 *   - View trips         : all authenticated roles
 *   - Create trip        : dispatcher, manager, admin
 *   - Attach orders      : dispatcher, manager, admin
 *   - Update trip status : dispatcher, manager, admin (CLOSED → admin/manager only in controller)
 *   - Print manifest     : all authenticated roles
 */
import { Router } from 'express';
import * as trips from '../controllers/tripsController.js';
import {
  requireLogin,
  requireRole,
  ROLES_MANAGE,
} from '../middleware/auth.js';

const ROLES_DISPATCHER = ['admin', 'manager', 'dispatcher'];

const router = Router();

router.get('/trips',                    requireLogin,                                    trips.list);
router.get('/trips/new',                requireLogin, requireRole(ROLES_DISPATCHER),    trips.showCreate);
router.post('/trips',                   requireLogin, requireRole(ROLES_DISPATCHER),    trips.create);

// Specific routes BEFORE generic :id route
router.post('/trips/:id/update-status', requireLogin, requireRole(ROLES_DISPATCHER),   trips.updateStatus);
router.post('/trips/:id/orders',        requireLogin, requireRole(ROLES_DISPATCHER),   trips.attachOrders);
router.get('/trips/:id/manifest',       requireLogin,                                   trips.printManifest);
router.get('/trips/:id/expenses/print', requireLogin,                                   trips.printExpenses);

router.post('/trips/:id/orders/:orderId/detach', requireLogin, requireRole(ROLES_DISPATCHER), trips.detachOrder);

router.post('/trips/:id/edit',          requireLogin, requireRole(ROLES_DISPATCHER),   trips.quickEdit);

// ─── API: active trips for scanner handoff picker ────────────────────────────
router.get('/api/trips/active',         requireLogin, requireRole(ROLES_DISPATCHER), trips.apiActiveTrips);
router.get('/api/trips/arriving',       requireLogin, requireRole(ROLES_DISPATCHER), trips.apiArrivingTrips);

// Generic :id route LAST
router.get('/trips/:id',                requireLogin,                                   trips.detail);

export default router;
