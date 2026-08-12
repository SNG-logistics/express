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
import { facebookVerify, facebookInbound, lineInbound } from '../controllers/webhookController.js';

const router = Router();

/**
 * Capture raw body string AND parse JSON.
 * This must be done in ONE middleware because we consume the stream here —
 * a subsequent express.json() would see an empty stream and return 500.
 */
function captureRawBody(req, res, next) {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.once('end', () => {
    req.rawBody = Buffer.concat(chunks).toString('utf8');
    // Parse JSON so req.body is available for the handler
    if (req.rawBody) {
      try { req.body = JSON.parse(req.rawBody); } catch { req.body = {}; }
    } else {
      req.body = {};
    }
    next();
  });
  // Safety: if stream errors, don't hang
  req.once('error', (err) => {
    console.error('[captureRawBody] stream error:', err.message);
    req.rawBody = '';
    req.body = {};
    next();
  });
}

// ── Facebook Messenger ────────────────────────────────────────────────────────
// Verification challenge: GET with hub.verify_token
router.get('/webhooks/facebook', facebookVerify);

// Inbound messages: POST — captureRawBody handles raw capture + JSON parse
router.post(
  '/webhooks/facebook',
  captureRawBody,
  facebookInbound
);

// ── LINE OA ────────────────────────────────────────────────────────────────────
// captureRawBody handles raw capture + JSON parse in one pass
router.post(
  '/webhooks/line',
  captureRawBody,
  lineInbound
);

export default router;
