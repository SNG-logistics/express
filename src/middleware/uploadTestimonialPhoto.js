import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testimonialUploadDir = path.join(__dirname, '../../public/uploads/testimonials');
try {
  if (!fs.existsSync(testimonialUploadDir)) {
    fs.mkdirSync(testimonialUploadDir, { recursive: true });
  }
} catch (err) {
  console.error('Warning: Failed to create testimonial upload dir:', err.message);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, testimonialUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'proof-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  },
});

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Unboxing photos customers sent us. Same shape as uploadProductPhoto, minus
 * GIF — these are camera photos, and allowing an animated format here only
 * widens what can be uploaded without serving any real case.
 */
export const uploadTestimonialPhoto = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!file.mimetype.startsWith('image/')) return cb(new Error('อัปโหลดได้เฉพาะไฟล์รูปภาพ'));
    if (!ALLOWED_EXT.has(ext)) return cb(new Error(`ไม่รองรับไฟล์นามสกุล ${ext}`));
    cb(null, true);
  },
});
