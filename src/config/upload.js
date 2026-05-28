import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Allowed extensions (whitelist — not just mimetype) ──────────────────────
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../public/uploads/orders');
try {
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }
} catch (err) {
    console.error('Warning: Failed to create upload directory on startup:', err.message);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Use only the validated extension, never the full original filename
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        // Double-check: mimetype AND extension must both be safe
        const ext = path.extname(file.originalname).toLowerCase();
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed'));
        }
        if (!ALLOWED_EXTENSIONS.has(ext)) {
            return cb(new Error(`Extension ${ext} is not allowed. Use: ${[...ALLOWED_EXTENSIONS].join(', ')}`));
        }
        cb(null, true);
    }
});

export default upload;

