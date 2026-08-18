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
router.get('/member/online', requireCustomerLogin, products.listProducts);

// Staff Admin Product Management
router.get('/admin/products', requireLogin, requireRole('admin', 'manager', 'staff'), products.adminListProducts);
router.get('/admin/products/new', requireLogin, requireRole('admin', 'manager'), products.adminShowCreate);
router.post('/admin/products', requireLogin, requireRole('admin', 'manager'), uploadProductPhoto.array('photos', 6), products.adminCreateProduct);
router.get('/admin/products/:id/edit', requireLogin, requireRole('admin', 'manager'), products.adminShowEdit);
router.post('/admin/products/:id', requireLogin, requireRole('admin', 'manager'), uploadProductPhoto.array('photos', 6), products.adminUpdateProduct);

export default router;
