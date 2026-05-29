/**
 * src/routes/webhooks.js
 * Public webhook endpoints for Facebook Messenger and LINE OA.
 * These routes are NOT behind requireLogin — they receive data from external platforms.
 *
 * Both routes capture raw body for signature verification:
 *  - Facebook: X-Hub-Signature-256 (HMAC-SHA256 with App Secret)
 *  - LINE:     X-Line-Signature    (HMAC-SHA256 with Channel Secret)
 */

import { Router } from 'express';
import express from 'express';
import { facebookVerify, facebookInbound, lineInbound } from '../controllers/webhookController.js';

const router = Router();

/**
 * Capture raw body string BEFORE express.json() parses it.
 * Required for HMAC signature verification on both FB and LINE.
 */
function captureRawBody(req, res, next) {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks).toString('utf8');
    next();
  });
}

// ── Facebook Messenger ────────────────────────────────────────────────────────
// Verification challenge: GET with hub.verify_token
router.get('/webhooks/facebook', facebookVerify);

// Inbound messages: POST — capture raw body first for X-Hub-Signature-256
router.post(
  '/webhooks/facebook',
  captureRawBody,
  express.json({ type: 'application/json' }),
  facebookInbound
);

// ── LINE OA ────────────────────────────────────────────────────────────────────
// Capture raw body for X-Line-Signature + parse JSON
router.post(
  '/webhooks/line',
  captureRawBody,
  express.json({ type: 'application/json' }),
  lineInbound
);

export default router;
