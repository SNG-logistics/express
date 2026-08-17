import { Router } from 'express';
import { requireLogin, requireRole } from '../middleware/auth.js';
import * as partner from '../controllers/partnerController.js';

const router = Router();
const staff = requireRole(['owner', 'admin', 'manager', 'staff', 'branch_operator']);

// ─── Partner Dashboard ────────────────────────────────────────────────────────
router.get('/partner',                requireLogin, staff, partner.dashboard);

// ─── Quotation CRUD ───────────────────────────────────────────────────────────
router.get('/partner/quotes',         requireLogin, staff, partner.list);
router.get('/partner/quotes/new',     requireLogin, staff, partner.newForm);
router.post('/partner/quotes',        requireLogin, staff, partner.create);
router.get('/partner/quotes/:id',     requireLogin, staff, partner.detail);
router.get('/partner/quotes/:id/print', requireLogin, staff, partner.printQuote);
router.post('/partner/quotes/:id/status', requireLogin, staff, partner.updateStatus);
router.post('/partner/quotes/:id/transition', requireLogin, staff, partner.transitionQuote);
router.post('/partner/quotes/:id/payment', requireLogin, staff, partner.recordQuotePayment);

// ─── Public Quote Requests (เช็คราคาสินค้าออนไลน์) ───────────────────────────
router.get('/partner/quote-requests',     requireLogin, staff, partner.quoteRequestQueue);
router.get('/partner/quote-requests/:id/convert', requireLogin, staff, partner.convertRequest);
router.post('/partner/quote-requests/:id/acknowledge', requireLogin, staff, partner.acknowledgeRequest);
router.post('/partner/quote-requests/:id/decline', requireLogin, staff, partner.declineRequest);
router.get('/partner/api/quote-requests/pending', requireLogin, staff, partner.pendingQuoteRequestsApi);

// ─── API (AJAX Calculator) — staff-role-gated consistently with siblings ─────
// (was requireLogin-only, a guard gap every sibling route — incl. the
// calculator's own pages — closes via the staff role group.)
router.get('/api/partner/calc',       requireLogin, staff, partner.apiCalc);

export default router;
