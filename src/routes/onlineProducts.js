/**
 * src/routes/onlineProducts.js
 *
 * Routes for the member-facing online products catalog (/member/online) and
 * staff admin management (/admin/products/*).
 */
import { Router } from 'express';
import * as products from '../controllers/onlineProductsController.js';
import { requireLogin, requireRole } from '../middleware/auth.js';
import { requireCustomerLogin } from '../middleware/customerAuth.js';
import { uploadProductPhoto } from '../middleware/uploadProductPhoto.js';

const router = Router();

// Member Catalog
// Browsing is public and acting is not: someone who taps the home-page banner
// must reach the products, not a login wall. The cards only link out to the
// platform's own listing, so there is nothing here to protect — asking for an
// account first would simply end the visit that marketing paid for.
router.get('/online', products.listProducts);
// The member path stays, so links already sent to customers keep working.
router.get('/member/online', requireCustomerLogin, products.listProducts);

// Staff Admin Product Management
router.get('/admin/products', requireLogin, requireRole('admin', 'manager', 'staff'), products.adminListProducts);
router.get('/admin/products/new', requireLogin, requireRole('admin', 'manager'), products.adminShowCreate);
router.post('/admin/products', requireLogin, requireRole('admin', 'manager'), uploadProductPhoto.array('photos', 6), products.adminCreateProduct);
router.get('/admin/products/:id/edit', requireLogin, requireRole('admin', 'manager'), products.adminShowEdit);
router.post('/admin/products/:id', requireLogin, requireRole('admin', 'manager'), uploadProductPhoto.array('photos', 6), products.adminUpdateProduct);
router.post('/admin/products/:id/delete', requireLogin, requireRole('admin', 'manager'), products.adminDeleteProduct);

export default router;
