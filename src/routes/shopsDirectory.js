/**
 * src/routes/shopsDirectory.js
 *
 * Routes for public shop directory, member reviews, and staff admin management.
 */
import { Router } from 'express';
import * as shops from '../controllers/shopsDirectoryController.js';
import { requireLogin, requireRole } from '../middleware/auth.js';
import { requireCustomerLogin } from '../middleware/customerAuth.js';
import { uploadShopPhoto } from '../middleware/uploadShopPhoto.js';

const router = Router();

// Public Shop Directory
router.get('/shops', shops.listShops);
router.get('/shops/:id', shops.shopDetail);
router.post('/shops/:id/reviews', requireCustomerLogin, shops.submitReview);

// Staff Admin Shop Management
router.get('/admin/shops', requireLogin, requireRole('admin', 'manager', 'staff'), shops.adminListShops);
router.get('/admin/shops/new', requireLogin, requireRole('admin', 'manager'), shops.adminShowCreate);
router.post('/admin/shops', requireLogin, requireRole('admin', 'manager'), uploadShopPhoto.single('photo'), shops.adminCreateShop);
router.get('/admin/shops/:id/edit', requireLogin, requireRole('admin', 'manager'), shops.adminShowEdit);
router.post('/admin/shops/:id', requireLogin, requireRole('admin', 'manager'), uploadShopPhoto.single('photo'), shops.adminUpdateShop);

// Staff Review Moderation
router.get('/admin/shops/reviews', requireLogin, requireRole('admin', 'manager', 'staff'), shops.adminListReviews);
router.post('/admin/shops/reviews/:id/status', requireLogin, requireRole('admin', 'manager', 'staff'), shops.adminModerateReview);

export default router;
