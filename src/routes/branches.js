import { Router } from 'express';
import * as branches from '../controllers/branchesController.js';
import { requireLogin, requireRole } from '../middleware/auth.js';
import upload from '../config/upload.js';

const router = Router();

// ─── Admin — Branch management ────────────────────────────────────────────────
router.get('/branches',          requireLogin, requireRole(['admin','manager']),      branches.list);
router.get('/branches/new',      requireLogin, requireRole(['admin','manager']),      branches.showCreate);
router.post('/branches',         requireLogin, requireRole(['admin','manager']),      branches.create);
router.get('/branches/:id',      requireLogin, requireRole(['admin','manager']),      branches.detail);
router.post('/branches/:id/status', requireLogin, requireRole(['admin','manager']),   branches.updateStatus);

// ─── Admin — Rider management (under a branch) ────────────────────────────────
router.post('/branches/:id/riders',        requireLogin, requireRole(['admin','manager']), branches.createRider);
router.post('/branches/:id/riders/:riderId/status', requireLogin, requireRole(['admin','manager']), branches.updateRiderStatus);

// ─── JSON API — for order form ────────────────────────────────────────────────
router.get('/api/branches/nearest', requireLogin, branches.nearestApi);

// ─── Branch Portal — for branch_operator role ─────────────────────────────────
router.get('/branch/dashboard', requireLogin, requireRole(['branch_operator','admin','manager']), branches.portalDashboard);
router.post('/branch/deliveries/:deliveryId/assign',  requireLogin, requireRole(['branch_operator','admin','manager']), branches.assignRider);
router.post('/branch/deliveries/:deliveryId/deliver', requireLogin, requireRole(['branch_operator','admin','manager']), upload.single('proof_image'), branches.markDelivered);

export default router;
