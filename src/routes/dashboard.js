import { Router } from 'express';
import { dashboard } from '../controllers/dashboardController.js';
import { requireLogin } from '../middleware/auth.js';

const router = Router();

// Riders have their own home (/rider) — keep them out of the ops dashboard.
function riderHome(req, res, next) {
  if (req.session.user?.role === 'rider') return res.redirect('/rider');
  return next();
}

router.get('/dashboard', requireLogin, riderHome, dashboard);

export default router;
