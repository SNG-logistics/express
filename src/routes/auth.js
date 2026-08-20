import { Router } from 'express';
import { showLogin, login, logout } from '../controllers/authController.js';
import { loginRateLimit } from '../middleware/auth.js';
import { getCompanySettings } from '../services/companySettingsService.js';

const router = Router();

/**
 * The login page prints the support number in its footer. It is loaded here
 * rather than in the controller because the controller renders that page from
 * four places, one of them inside a session callback that cannot await.
 *
 * A failure is swallowed on purpose: the login page is what people reach for
 * when something is already broken, and it must not be taken down by a lookup
 * that only decides a footer line.
 */
async function withCompanyContact(req, res, next) {
  try {
    res.locals.company = await getCompanySettings();
  } catch (err) {
    console.error('[AUTH] company settings lookup failed:', err.message);
    res.locals.company = {};
  }
  next();
}

router.get('/login',   withCompanyContact, showLogin);
router.post('/login',  loginRateLimit, withCompanyContact, login);   // ← brute-force guard
router.post('/logout', logout);

export default router;
