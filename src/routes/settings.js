import { Router } from 'express';
import { requireLogin, requireRole } from '../middleware/auth.js';
import * as settings from '../controllers/settingsController.js';
import multer from 'multer';
import { uploadTestimonialPhoto } from '../middleware/uploadTestimonialPhoto.js';
import { uploadPopupImage } from '../middleware/uploadPopupImage.js';
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

// Home promo banner. Its own folder rather than sharing the logo's, so a
// banner can never be mistaken for a logo when either is replaced.
const bannerDir = path.join(__dirname, '../../public/uploads/banner');
if (!fs.existsSync(bannerDir)) fs.mkdirSync(bannerDir, { recursive: true });

const bannerUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, bannerDir),
    filename:    (req, file, cb) => cb(null, 'banner-' + Date.now() + path.extname(file.originalname).toLowerCase()),
  }),
  // Larger than the logo cap: this is a full-bleed photograph, and squeezing it
  // under 2MB would show as visible artefacts on the biggest image on the site.
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    const ext = path.extname(file.originalname).toLowerCase();
    if (!file.mimetype.startsWith('image/') || !allowed.has(ext)) {
      return cb(new Error('อนุญาตเฉพาะไฟล์รูปภาพ (.jpg, .png, .webp)'));
    }
    cb(null, true);
  },
});

const router = Router();

// ─── Member-facing UI settings hub ────────────────────────────────────────────
// Broadest of the individual gates below — a tab's own write actions stay
// protected by that tab's existing POST route, unchanged.
router.get('/settings/member', requireLogin, requireRole('admin', 'manager', 'staff'), settings.showMemberSettings);

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

router.get('/settings/testimonials', requireLogin, requireRole(['admin','manager']), settings.showTestimonials);
router.post('/settings/testimonials', requireLogin, requireRole(['admin','manager']), uploadTestimonialPhoto.single('photo'), settings.createTestimonial);
router.post('/settings/testimonials/:id', requireLogin, requireRole(['admin','manager']), uploadTestimonialPhoto.single('photo'), settings.updateTestimonial);
router.post('/settings/testimonials/:id/delete', requireLogin, requireRole(['admin','manager']), settings.deleteTestimonial);

router.post('/settings/home-banner', requireLogin, requireRole(['admin','manager']), bannerUpload.single('banner_file'), settings.uploadHomeBanner);
router.post('/settings/home-banner/remove', requireLogin, requireRole(['admin','manager']), settings.removeHomeBanner);

router.post('/settings/popup', requireLogin, requireRole(['admin','manager']), uploadPopupImage.single('popup_file'), settings.savePopup);
router.post('/settings/popup/remove', requireLogin, requireRole(['admin','manager']), settings.removePopup);

router.post('/settings/clear-test-data', requireLogin, requireRole('admin'), settings.clearTestData);

// ─── Company Profile (Admin only) ─────────────────────────────────────────────
router.post('/settings/company-profile', requireLogin, requireRole('admin'), settings.updateCompanyProfile);
router.post('/settings/purchase-agent', requireLogin, requireRole(['admin','manager']), settings.updatePurchaseAgentSettings);
router.post('/settings/company-logo',    requireLogin, requireRole('admin'), logoUpload.single('logo_file'), settings.uploadCompanyLogo);

export default router;
