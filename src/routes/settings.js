import { Router } from 'express';
import { requireLogin, requireRole } from '../middleware/auth.js';
import * as settings from '../controllers/settingsController.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Logo upload storage (saved to public/uploads/logo/)
const logoDir = path.join(__dirname, '../../public/uploads/logo');
if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir, { recursive: true });

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, logoDir),
    filename:    (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, 'logo-' + Date.now() + ext);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['.jpg','.jpeg','.png','.webp','.gif','.svg']);
    const ext = path.extname(file.originalname).toLowerCase();
    if (!file.mimetype.startsWith('image/') || !allowed.has(ext))
      return cb(new Error('อนุญาตเฉพาะไฟล์รูปภาพ (.jpg, .png, .webp, .svg)'));
    cb(null, true);
  }
});

const router = Router();

// ─── Shipping Rate (Admin only) ───────────────────────────────────────────────
router.get('/settings/rates', requireLogin, requireRole('admin'), settings.showRates);
router.post('/settings/rates', requireLogin, requireRole('admin'), settings.createRate);
router.post('/settings/rates/:id/delete', requireLogin, requireRole('admin'), settings.deleteRate);

// ─── Exchange Rate Manager (Admin / Manager) ──────────────────────────────────
router.post('/settings/exchange-rate', requireLogin, requireRole(['admin','manager']), settings.setExchangeRate);

// API Route (Used by Order Form - accessible by staff)
router.get('/api/shipping-price', requireLogin, settings.calculatePrice);
router.get('/api/exchange-rate', requireLogin, settings.getLatestRate);

// ─── Danger Zone (Super Admin only) ───────────────────────────────────────────
router.get('/settings/prohibited', requireLogin, requireRole(['admin','manager']), settings.showProhibitedItems);
router.post('/settings/prohibited', requireLogin, requireRole(['admin','manager']), settings.createProhibitedItem);
router.post('/settings/prohibited/:id', requireLogin, requireRole(['admin','manager']), settings.updateProhibitedItem);
router.post('/settings/prohibited/:id/delete', requireLogin, requireRole(['admin','manager']), settings.deleteProhibitedItem);

router.post('/settings/clear-test-data', requireLogin, requireRole('admin'), settings.clearTestData);

// ─── Company Profile (Admin only) ─────────────────────────────────────────────
router.post('/settings/company-profile', requireLogin, requireRole('admin'), settings.updateCompanyProfile);
router.post('/settings/company-logo',    requireLogin, requireRole('admin'), logoUpload.single('logo_file'), settings.uploadCompanyLogo);

export default router;
