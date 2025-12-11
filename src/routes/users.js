import { Router } from 'express';
import { index, create, resetPassword, destroy } from '../controllers/usersController.js';
import { requireLogin, requireRole } from '../middleware/auth.js';

const router = Router();

// Retrieve all users (Admin only)
router.get('/users', requireLogin, requireRole('admin'), index);

// Create a new user
router.post('/users', requireLogin, requireRole('admin'), create);

// Reset Password
router.post('/users/:id/reset-password', requireLogin, requireRole('admin'), resetPassword);

// Delete User
router.post('/users/:id/delete', requireLogin, requireRole('admin'), destroy);

export default router;
