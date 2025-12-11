import { Router } from 'express';
import { showStatus, getStatusApi, restartApi } from '../controllers/whatsappController.js';
import { requireLogin, requireRole } from '../middleware/auth.js';

const router = Router();

// Only admin/manager can access WhatsApp control
router.get('/whatsapp', requireLogin, requireRole('admin', 'manager'), showStatus);
router.get('/whatsapp/api/status', requireLogin, requireRole('admin', 'manager'), getStatusApi);
router.post('/whatsapp/api/restart', requireLogin, requireRole('admin', 'manager'), restartApi);

export default router;
