import { Router } from 'express';
import * as dispatch from '../controllers/dispatchController.js';
import { requireLogin, requireRole } from '../middleware/auth.js';

const router = Router();

// Only admin, manager, dispatcher, or warehouse_la would typically access this
// (owner passes via the wildcard in requireRole).
const ROLES_DISPATCH = ['admin','manager','dispatcher','warehouse_la'];

router.get('/dispatch/sorting', requireLogin, requireRole(ROLES_DISPATCH), dispatch.showSortingBoard);
router.post('/dispatch/assign', requireLogin, requireRole(ROLES_DISPATCH), dispatch.assignOrders);

export default router;
