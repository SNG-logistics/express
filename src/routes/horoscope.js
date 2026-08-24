/**
 * src/routes/horoscope.js
 *
 * The member-facing horoscope page (/member/horoscope). Login-required —
 * confirmed with the owner, no public/guest preview (unlike /online).
 */
import { Router } from 'express';
import { showHoroscope } from '../controllers/horoscopeController.js';
import { requireCustomerLogin } from '../middleware/customerAuth.js';

const router = Router();

router.get('/member/horoscope', requireCustomerLogin, showHoroscope);

export default router;
