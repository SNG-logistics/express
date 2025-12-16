import { Router } from 'express';
import * as scanner from '../controllers/scannerController.js';
import { requireLogin } from '../middleware/auth.js';

const router = Router();

// Scanner interface
router.get('/scanner', requireLogin, scanner.showScanner);

// Scanner API
router.post('/scanner/scan', requireLogin, scanner.processScan);
router.post('/scanner/update/:id', requireLogin, scanner.quickStatusUpdate);

export default router;
