/**
 * src/routes/spaceBooking.js — ร้านฝากส่ง (Space Booking)
 */
import { Router } from 'express';
import * as sb from '../controllers/spaceBookingController.js';
import { requireLogin, requireRole } from '../middleware/auth.js';

const ROLES_FREIGHT = ['admin', 'manager', 'dispatcher', 'finance', 'staff'];

const router = Router();

// ─── Partners ────────────────────────────────────────────────────────────────
router.get('/freight/partners',        requireLogin, requireRole(ROLES_FREIGHT), sb.listPartners);
router.post('/freight/partners',       requireLogin, requireRole(ROLES_FREIGHT), sb.createPartner);
router.post('/freight/partners/:id',   requireLogin, requireRole(ROLES_FREIGHT), sb.updatePartner);

// ─── Bookings ────────────────────────────────────────────────────────────────
router.get('/freight',                 requireLogin, requireRole(ROLES_FREIGHT), sb.listBookings);
router.get('/freight/new',             requireLogin, requireRole(ROLES_FREIGHT), sb.showCreateBooking);
router.post('/freight',                requireLogin, requireRole(ROLES_FREIGHT), sb.createBooking);
router.get('/freight/:id(\\d+)',       requireLogin, requireRole(ROLES_FREIGHT), sb.bookingDetail);
router.post('/freight/:id/status',     requireLogin, requireRole(ROLES_FREIGHT), sb.updateStatus);
router.post('/freight/:id/payment',    requireLogin, requireRole(ROLES_FREIGHT), sb.recordPayment);

// ─── Print documents ─────────────────────────────────────────────────────────
router.get('/freight/:id/quote',       requireLogin, requireRole(ROLES_FREIGHT), sb.printQuote);
router.get('/freight/:id/invoice',     requireLogin, requireRole(ROLES_FREIGHT), sb.printInvoice);

export default router;
