import { Router } from 'express';
import { requireLogin, requireRole } from '../middleware/auth.js';
import * as settings from '../controllers/settingsController.js';

const router = Router();

// UI Routes (Admin only)
router.get('/settings/rates', requireLogin, requireRole('admin'), settings.showRates);
router.post('/settings/rates', requireLogin, requireRole('admin'), settings.createRate);
router.post('/settings/rates/:id/delete', requireLogin, requireRole('admin'), settings.deleteRate);

// API Route (Used by Order Form - accessible by staff)
router.get('/api/shipping-price', requireLogin, settings.calculatePrice);

export default router;
