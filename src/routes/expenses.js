import express from 'express';
import multer from 'multer';
import path from 'path';
import { requireAnyRole, ROLES_MANAGE, ROLES_FINANCE, ROLES_WAREHOUSE, ROLES_DELIVERY_WRITE } from '../middleware/auth.js';
import * as expensesController from '../controllers/expensesController.js';

const router = express.Router();

// Role configuration
// Admins, Managers, and Finance can access everything
// Drivers, Dispatchers can ADD expenses (for trips) but maybe shouldn't see Capital expenses
const ROLES_EXPENSES_VIEW = ['admin', 'manager', 'finance'];
const ROLES_EXPENSES_ADD  = ['admin', 'manager', 'finance', 'dispatcher', 'driver_support'];

// Configure Multer for receipt uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // We assume public/uploads/expenses exists. Let's make sure it does in app.js or here
    import('fs').then(fs => {
      const dir = path.join(process.cwd(), 'public', 'uploads', 'expenses');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      cb(null, dir);
    });
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'receipt-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('รองรับเฉพาะไฟล์รูปภาพ หรือ PDF เท่านั้น'));
    }
  }
});

// View Dashboard / List
router.get('/', requireAnyRole(ROLES_EXPENSES_VIEW), expensesController.index);

// Export Excel (CSV)
router.get('/export', requireAnyRole(ROLES_EXPENSES_VIEW), expensesController.exportExcel);

// Print Report (A4 PDF/Paper layout)
router.get('/print', requireAnyRole(ROLES_EXPENSES_VIEW), expensesController.printReport);

// P&L Profit and Loss Report
router.get('/pl', requireAnyRole(ROLES_EXPENSES_VIEW), expensesController.plReport);

// Create Expense Form
router.get('/new', requireAnyRole(ROLES_EXPENSES_ADD), expensesController.newExpense);

// Save Expense
router.post('/create', requireAnyRole(ROLES_EXPENSES_ADD), upload.single('receipt_image'), expensesController.create);

// Delete Expense
router.post('/:id/delete', requireAnyRole(['admin', 'manager']), expensesController.destroy);

export default router;
