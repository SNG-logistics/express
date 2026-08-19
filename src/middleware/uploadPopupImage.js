import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const popupUploadDir = path.join(__dirname, '../../public/uploads/popup');
try {
  if (!fs.existsSync(popupUploadDir)) {
    fs.mkdirSync(popupUploadDir, { recursive: true });
  }
} catch (err) {
  console.error('Warning: Failed to create popup upload dir:', err.message);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, popupUploadDir),
  filename: (req, file, cb) => {
    cb(null, 'popup-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + '.png');
  },
});

/**
 * The bottom-right floating popup shown on every customer page. PNG only —
 * this is a small badge-style image meant to float over page content, so a
 * transparent background matters here in a way it doesn't for the (JPG-
 * friendly) full-bleed home banner.
 */
export const uploadPopupImage = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype !== 'image/png' || ext !== '.png') {
      return cb(new Error('อัปโหลดได้เฉพาะไฟล์ PNG เท่านั้น'));
    }
    cb(null, true);
  },
});
