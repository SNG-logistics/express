import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const shopUploadDir = path.join(__dirname, '../../public/uploads/shops');
try {
  if (!fs.existsSync(shopUploadDir)) {
    fs.mkdirSync(shopUploadDir, { recursive: true });
  }
} catch (err) {
  console.error('Warning: Failed to create shop upload dir:', err.message);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, shopUploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'shop-' + uniqueSuffix + ext);
  }
});

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

export const uploadShopPhoto = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    if (!ALLOWED_EXT.has(ext)) {
      return cb(new Error(`Extension ${ext} is not allowed`));
    }
    cb(null, true);
  }
});
