/**
 * src/routes/riders.js — admin management of HQ (main-warehouse) riders.
 * Distinct from src/routes/rider.js, which is the rider's own portal.
 * No branch-scoped operator override here (there's no "own branch" for HQ) —
 * admin/manager only. (owner passes every guard via the wildcard in requireRole.)
 */
import { Router } from 'express';
import { requireLogin, requireRole } from '../middleware/auth.js';
import * as riderAdmin from '../controllers/riderAdminController.js';

const router = Router();

router.get('/riders',                    requireLogin, requireRole(['admin', 'manager']), riderAdmin.index);
router.post('/riders',                   requireLogin, requireRole(['admin', 'manager']), riderAdmin.create);
router.post('/riders/:riderId/status',   requireLogin, requireRole(['admin', 'manager']), riderAdmin.updateStatus);

export default router;
