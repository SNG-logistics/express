/**
 * src/routes/rider.js — Rider Mode routes
 * Role: 'rider' only (restricted access)
 */
import { Router } from 'express';
import * as rider from '../controllers/riderController.js';
import { requireLogin, requireRole, ROLES_RIDER } from '../middleware/auth.js';
import upload from '../config/upload.js';

const router = Router();

// ── Pages ─────────────────────────────────────────────────────────────────────
router.get('/rider',                        requireLogin, requireRole(ROLES_RIDER), rider.myJobs);
router.get('/rider/history',                requireLogin, requireRole(ROLES_RIDER), rider.history);
router.get('/rider/job/:orderId',           requireLogin, requireRole(ROLES_RIDER), rider.jobDetail);

// ── Job offers (broadcast & claim) ──────────────────────────────────────────────
router.get('/rider/offers',                 requireLogin, requireRole(ROLES_RIDER), rider.availableOffersApi);
router.post('/rider/offers/:id/claim',      requireLogin, requireRole(ROLES_RIDER), rider.claimOfferHttp);

// ── AJAX API ──────────────────────────────────────────────────────────────────
router.post('/rider/job/:orderId/accept',   requireLogin, requireRole(ROLES_RIDER), rider.acceptJob);
router.post('/rider/job/:orderId/pickup',   requireLogin, requireRole(ROLES_RIDER), rider.pickupJob);
router.post('/rider/job/:orderId/deliver',  requireLogin, requireRole(ROLES_RIDER), upload.array('pod_photos', 3), rider.deliverJob);
router.post('/rider/job/:orderId/fail',     requireLogin, requireRole(ROLES_RIDER), upload.array('fail_photos', 2), rider.failJob);

export default router;
