import { Router } from 'express';
import { dashboard } from '../controllers/dashboardController.js';
import { requireLogin } from '../middleware/auth.js';

const router = Router();

router.get('/dashboard', requireLogin, dashboard);

export default router;
