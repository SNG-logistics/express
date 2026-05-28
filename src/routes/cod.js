/**
 * src/routes/cod.js — COD routes with role guards
 *
 * Access control:
 *   - View COD list        : finance, admin, manager, dispatcher
 *   - Set COD amount       : admin, manager, dispatcher (edit-time action)
 *   - Mark collected       : admin, manager, finance, dispatcher
 *   - Mark remitted        : admin, manager, finance only (financial action)
 *   - Close after remit    : admin, manager only (irreversible)
 */
import { Router } from 'express';
import { requireLogin, requireRole, ROLES_FINANCE, ROLES_MANAGE, ROLES_COD_COLLECT, ROLES_COD_REMIT } from '../middleware/auth.js';
import * as cod from '../controllers/codController.js';

const router = Router();

router.get('/cod',              requireLogin, requireRole([...ROLES_FINANCE, 'dispatcher']),  cod.index);
router.post('/cod/:id/amount',  requireLogin, requireRole(['admin','manager','dispatcher']),  cod.setAmount);
router.post('/cod/:id/collect', requireLogin, requireRole(ROLES_COD_COLLECT),                cod.markCollected);
router.post('/cod/:id/remit',   requireLogin, requireRole(ROLES_COD_REMIT),                  cod.markRemitted);
router.post('/cod/:id/close',   requireLogin, requireRole(ROLES_MANAGE),                     cod.closeAfterRemit);
router.post('/cod',             requireLogin, (req, res) => res.redirect('/cod'));

export default router;
