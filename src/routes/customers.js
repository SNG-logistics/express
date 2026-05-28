/**
 * src/routes/customers.js — Customer management routes
 *
 * ⚠️ SECURITY FIX: Previously had NO authentication on any route.
 * All routes now require login + appropriate role.
 *
 * Access control:
 *   - List / view       : all authenticated staff
 *   - Create customer   : all order-writing roles
 *   - Edit customer     : dispatcher + above
 *   - Delete customer   : admin + manager only (destructive — may break order history)
 */
import { Router } from 'express';
import * as customersController from '../controllers/customersController.js';
import {
  requireLogin,
  requireRole,
  ROLES_ORDER_WRITE,
  ROLES_MANAGE,
} from '../middleware/auth.js';

const ROLES_CUSTOMER_VIEW = ['admin', 'manager', 'dispatcher', 'warehouse_th', 'warehouse_la', 'finance', 'staff', 'customs'];
const ROLES_CUSTOMER_EDIT = ['admin', 'manager', 'dispatcher'];

const router = Router();

router.get('/customers',             requireLogin, requireRole(ROLES_CUSTOMER_VIEW),  customersController.list);
router.get('/customers/new',         requireLogin, requireRole(ROLES_ORDER_WRITE),     customersController.showCreate);
router.post('/customers',            requireLogin, requireRole(ROLES_ORDER_WRITE),     customersController.create);
router.get('/customers/:id/edit',    requireLogin, requireRole(ROLES_CUSTOMER_EDIT),   customersController.showEdit);
router.post('/customers/:id',        requireLogin, requireRole(ROLES_CUSTOMER_EDIT),   customersController.update);
router.post('/customers/:id/delete', requireLogin, requireRole(ROLES_MANAGE),         customersController.remove);

export default router;
