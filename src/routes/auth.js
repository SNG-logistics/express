import { Router } from 'express';
import { showLogin, login, logout } from '../controllers/authController.js';

const router = Router();

router.get('/login', showLogin);
router.post('/login', login);
router.post('/logout', logout);

export default router;
