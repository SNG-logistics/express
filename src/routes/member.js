/**
 * src/routes/member.js
 *
 * Member account routes — registration, OTP verification, login, profile, and parcel history.
 */
import { Router } from 'express';
import * as member from '../controllers/memberController.js';
import { requireCustomerLogin, memberLoginRateLimit } from '../middleware/customerAuth.js';

const router = Router();

router.get('/member', member.memberRoot);

// Registration & OTP
router.get('/member/register', member.showRegister);
router.post('/member/register', member.processRegister);
router.get('/member/verify', member.showVerify);
router.post('/member/verify', member.processVerify);
router.post('/member/verify/resend', member.resendOtp);

// Auth
router.get('/member/login', member.showLogin);
router.post('/member/login', memberLoginRateLimit, member.processLogin);
router.get('/member/logout', member.logout);

// Forgot Password
router.get('/member/forgot-password', member.showForgotPassword);
router.post('/member/forgot-password', member.processForgotPassword);
router.get('/member/reset-password', member.showResetPassword);
router.post('/member/reset-password', member.processResetPassword);

// Member Dashboard & Settings (Guarded by requireCustomerLogin)
router.get('/member/profile', requireCustomerLogin, member.profile);
router.get('/member/orders', requireCustomerLogin, member.myOrders);
router.get('/member/account', requireCustomerLogin, member.accountEdit);
router.post('/member/account', requireCustomerLogin, member.processAccountEdit);

export default router;
