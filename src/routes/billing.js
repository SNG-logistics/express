/**
 * src/routes/billing.js — Monthly billing statement routes (net-off against COD)
 *
 * Access control:
 *   - View statements/print  : finance, admin, manager, accounting (read-only)
 *   - Create statement       : admin, manager, finance only (financial action)
 *   - Settle statement       : admin, manager, finance only (irreversible, bulk-closes orders)
 *   (owner passes every guard via the wildcard in requireRole.)
 */
import { Router } from 'express';
import { requireLogin, requireRole, ROLES_FINANCE_VIEW, ROLES_FINANCE } from '../middleware/auth.js';
import * as billing from '../controllers/billingController.js';

const router = Router();

router.get('/billing',                 requireLogin, requireRole(ROLES_FINANCE_VIEW), billing.index);
router.post('/billing/statements',     requireLogin, requireRole(ROLES_FINANCE),      billing.create);
router.get('/billing/:id',             requireLogin, requireRole(ROLES_FINANCE_VIEW), billing.show);
router.get('/billing/:id/print',       requireLogin, requireRole(ROLES_FINANCE_VIEW), billing.print);
router.post('/billing/:id/settle',     requireLogin, requireRole(ROLES_FINANCE),      billing.settle);

export default router;
