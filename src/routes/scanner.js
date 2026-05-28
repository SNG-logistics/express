/**
 * src/routes/scanner.js — Warehouse Scan & Receive routes
 *
 * Access control:
 *   ROLES_SCANNER = warehouse_th, warehouse_la, dispatcher, branch_operator, admin, manager
 *
 * Endpoints:
 *   GET  /scanner                         — hub / mode selector
 *   GET  /scanner/receive                 — batch receive mode
 *   GET  /scanner/handoff/:tripId         — trip handoff scan screen
 *   POST /scanner/scan                    — lookup parcel (AJAX)
 *   POST /scanner/update/:id              — quick status push (AJAX)
 *   POST /scanner/receive/:id             — receive parcel with condition (AJAX)
 *   POST /scanner/exception/:id           — log exception (AJAX)
 *   POST /scanner/handoff/:tripId/confirm/:orderId — confirm on-truck (AJAX)
 *   GET  /scanner/session                 — today's scan summary (AJAX)
 */
import { Router } from 'express';
import * as scanner from '../controllers/scannerController.js';
import { requireLogin, requireRole, ROLES_SCANNER } from '../middleware/auth.js';
import upload from '../config/upload.js';

const router = Router();

// ─── Page routes ──────────────────────────────────────────────────────────────
router.get('/scanner',                         requireLogin, requireRole(ROLES_SCANNER), scanner.showScanner);
router.get('/scanner/pda',                     requireLogin, requireRole(ROLES_SCANNER), scanner.showPda);
router.get('/scanner/auto',                    requireLogin, requireRole(ROLES_SCANNER), scanner.showAutoScan);
router.get('/scanner/quick',                   requireLogin, requireRole(ROLES_SCANNER), scanner.showQuickScan);
router.get('/scanner/lookup',                  requireLogin, requireRole(ROLES_SCANNER), scanner.showLookup);
router.get('/scanner/receive',                 requireLogin, requireRole(ROLES_SCANNER), scanner.showReceive);
router.get('/scanner/handoff/:tripId',         requireLogin, requireRole(ROLES_SCANNER), scanner.showHandoff);

// ─── AJAX API routes ──────────────────────────────────────────────────────────
router.post('/scanner/scan',                   requireLogin, requireRole(ROLES_SCANNER), scanner.processScan);
router.post('/scanner/auto-update',            requireLogin, requireRole(ROLES_SCANNER), scanner.processAutoScan);
router.post('/scanner/update/:id',             requireLogin, requireRole(ROLES_SCANNER), scanner.quickStatusUpdate);
router.post('/scanner/receive/:id',            requireLogin, requireRole(ROLES_SCANNER), upload.array('intake_photos', 5), scanner.receiveParcel);
router.post('/scanner/exception/:id',          requireLogin, requireRole(ROLES_SCANNER), scanner.logException);
router.post('/scanner/handoff/:tripId/confirm/:orderId',
                                               requireLogin, requireRole(ROLES_SCANNER), scanner.confirmHandoff);
router.get('/scanner/unload/:tripId',          requireLogin, requireRole(ROLES_SCANNER), scanner.showUnload);
router.post('/scanner/unload/:tripId/confirm/:orderId', requireLogin, requireRole(ROLES_SCANNER), scanner.confirmUnload);
router.get('/scanner/session',                 requireLogin, requireRole(ROLES_SCANNER), scanner.sessionSummary);

// ─── Screening ────────────────────────────────────────────────────────────────
router.get('/scanner/screening',               requireLogin, requireRole(ROLES_SCANNER), scanner.showScreening);
router.post('/scanner/screening/:id',          requireLogin, requireRole(ROLES_SCANNER), scanner.processScreening);

export default router;
