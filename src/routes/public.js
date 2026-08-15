import { Router } from 'express';
import * as publicController from '../controllers/publicController.js';
import { publicRateLimit } from '../middleware/auth.js';

const router = Router();

router.use((req, res, next) => {
  res.locals.portalCurrentUser = req.session?.customer || null;
  next();
});

router.get('/calculate', publicController.calculatePage);
router.get('/api/public/shipping-quote',
  publicRateLimit({ max: 60, windowMs: 15 * 60 * 1000 }),
  publicController.shippingQuote);

export default router;
