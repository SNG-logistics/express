import { Router } from 'express';
import * as dispatch from '../controllers/dispatchController.js';
import { requireLogin, requireRole } from '../middleware/auth.js';

const router = Router();

// Only admin, manager, dispatcher, or lao_warehouse would typically access this
const ROLES_DISPATCH = ['admin','manager','dispatcher','lao_warehouse'];

router.get('/dispatch/sorting', requireLogin, requireRole(ROLES_DISPATCH), dispatch.showSortingBoard);
router.post('/dispatch/assign', requireLogin, requireRole(ROLES_DISPATCH), dispatch.assignOrders);

export default router;
