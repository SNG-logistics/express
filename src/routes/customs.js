/**
 * src/routes/customs.js — Customs clearance routes with role guards
 *
 * Access control:
 *   - View customs queue   : customs, admin, manager, dispatcher
 *   - Start clearance      : customs, admin, manager
 *   - Clear (approve)      : customs, admin, manager
 *   - Reject               : customs, admin, manager
 *
 * 'dispatcher' can VIEW queue but cannot approve/reject customs decisions.
 */
import { Router } from 'express';
import { requireLogin, requireRole, ROLES_CUSTOMS } from '../middleware/auth.js';
import * as customs from '../controllers/customsController.js';

const router = Router();

router.get('/customs',              requireLogin, requireRole([...ROLES_CUSTOMS, 'dispatcher']), customs.list);
router.get('/customs/:id',          requireLogin, requireRole([...ROLES_CUSTOMS, 'dispatcher']), customs.detail);
router.post('/customs/:id/start',   requireLogin, requireRole(ROLES_CUSTOMS),                   customs.start);
router.post('/customs/:id/clear',   requireLogin, requireRole(ROLES_CUSTOMS),                   customs.clear);
router.post('/customs/:id/reject',  requireLogin, requireRole(ROLES_CUSTOMS),                   customs.reject);

export default router;
