import { Router } from 'express';
import { requireLogin, requireRole } from '../middleware/auth.js';
import * as partner from '../controllers/partnerController.js';

const router = Router();
const staff = requireRole(['admin', 'manager', 'staff', 'branch_operator']);

// ─── Partner Dashboard ────────────────────────────────────────────────────────
router.get('/partner',                requireLogin, staff, partner.dashboard);

// ─── Quotation CRUD ───────────────────────────────────────────────────────────
router.get('/partner/quotes',         requireLogin, staff, partner.list);
router.get('/partner/quotes/new',     requireLogin, staff, partner.newForm);
router.post('/partner/quotes',        requireLogin, staff, partner.create);
router.get('/partner/quotes/:id',     requireLogin, staff, partner.detail);
router.get('/partner/quotes/:id/print', requireLogin, staff, partner.printQuote);
router.post('/partner/quotes/:id/status', requireLogin, staff, partner.updateStatus);

// ─── API (AJAX Calculator) ────────────────────────────────────────────────────
router.get('/api/partner/calc',       requireLogin, partner.apiCalc);

export default router;
