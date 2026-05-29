/**
 * src/routes/webhookSim.js
 * Webhook simulator routes — DEV ONLY.
 * Blocked entirely in production via NODE_ENV check.
 */

import { Router } from 'express';
import express from 'express';
import { requireLogin } from '../middleware/auth.js';
import { simPage, simSend } from '../controllers/webhookSimController.js';

const router = Router();

// Block in production
function devOnly(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).send('Not found');
  }
  return next();
}

router.get('/dev/webhook-sim',
  devOnly,
  requireLogin,
  simPage
);

router.post('/dev/webhook-sim/send',
  devOnly,
  requireLogin,
  express.json(),
  simSend
);

export default router;
