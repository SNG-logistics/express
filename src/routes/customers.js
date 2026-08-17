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
 *   - Invite to member portal : dispatcher + above (customer-service task, low risk —
 *     only sends a WhatsApp link, doesn't change any relationship)
 *   - Link / unlink member account : admin + manager only (changes which member
 *     account a customer's identity/history resolves to — tighter than a plain
 *     address edit)
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
router.post('/customers/:id/invite-member', requireLogin, requireRole(ROLES_CUSTOMER_EDIT), customersController.inviteMember);
router.post('/customers/:id/link-member',   requireLogin, requireRole(ROLES_MANAGE),   customersController.linkMember);
router.post('/customers/:id/unlink-member', requireLogin, requireRole(ROLES_MANAGE),   customersController.unlinkMember);
router.post('/customers/:id/delete', requireLogin, requireRole(ROLES_MANAGE),         customersController.remove);

export default router;
