import { Router } from 'express';
import { requireLogin } from '../middleware/auth.js';
import * as customs from '../controllers/customsController.js';

const router = Router();

router.get('/customs', requireLogin, customs.list);
router.get('/customs/:id', requireLogin, customs.detail);
router.post('/customs/:id/start', requireLogin, customs.start);
router.post('/customs/:id/clear', requireLogin, customs.clear);

export default router;
