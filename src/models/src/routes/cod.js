import { Router } from 'express';
import { requireLogin } from '../middleware/auth.js';
import * as cod from '../controllers/codController.js';

const router = Router();

router.get('/cod', requireLogin, cod.index);
router.post('/cod/:id/amount', requireLogin, cod.setAmount);
router.post('/cod/:id/collect', requireLogin, cod.markCollected);
router.post('/cod/:id/remit', requireLogin, cod.markRemitted);
router.post('/cod', requireLogin, (req, res) => res.redirect('/cod'));

export default router;
