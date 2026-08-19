import { Router } from 'express';
import * as publicController from '../controllers/publicController.js';
import { publicRateLimit } from '../middleware/auth.js';

const router = Router();

router.use((req, res, next) => {
  res.locals.portalCurrentUser = req.session?.customer || null;
  next();
});

router.get('/home', publicController.home);
router.get('/calculate', publicController.calculatePage);
router.get('/api/public/shipping-quote',
  publicRateLimit({ max: 60, windowMs: 15 * 60 * 1000 }),
  publicController.shippingQuote);

// "What will it cost to have you buy this for me?" — answered without a login
// and without waiting for staff, because that question is where the marketing
// promise either converts or is abandoned.
router.get('/buy', publicController.purchaseEstimatePage);
router.get('/api/public/purchase-estimate',
  publicRateLimit({ max: 60, windowMs: 15 * 60 * 1000 }),
  publicController.purchaseEstimate);

export default router;
