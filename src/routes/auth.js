import { Router } from 'express';
import { showLogin, login, logout } from '../controllers/authController.js';
import { loginRateLimit } from '../middleware/auth.js';

const router = Router();

router.get('/login',   showLogin);
router.post('/login',  loginRateLimit, login);   // ← brute-force guard
router.post('/logout', logout);

export default router;
