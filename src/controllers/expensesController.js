import pool from '../config/db.js';
import fs from 'fs';
import path from 'path';

const CATEGORY_MAP = {
  'CAPITAL': 'เงินลงทุน/ก่อตั้ง (CAPEX)',
  'TRIP': 'รายจ่ายรอบรถ (OPEX)',
  'ADMIN': 'รายจ่ายบริหาร (Admin)'
};

export async function index(req, res) {
  try {
    // 1. Fetch expenses
    const [expenses] = await pool.query(`
      SELECT e.*, u.name as created_by_name, t.trip_no 
      FROM expenses e
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN trips t ON e.trip_id = t.id
      ORDER BY e.expense_date DESC, e.created_at DESC
      LIMIT 100
    `);

    // 2. Calculate summaries
    const [[summary]] = await pool.query(`
      SELECT 
        SUM(CASE WHEN category = 'CAPITAL' AND (currency = 'THB' OR currency IS NULL) THEN amount ELSE 0 END) as total_capital_thb,
        SUM(CASE WHEN category = 'CAPITAL' AND currency = 'LAK' THEN amount ELSE 0 END) as total_capital_lak,
        SUM(CASE WHEN category = 'CAPITAL' AND currency = 'USD' THEN amount ELSE 0 END) as total_capital_usd,
        SUM(CASE WHEN category = 'TRIP' AND (currency = 'THB' OR currency IS NULL) THEN amount ELSE 0 END) as total_trip_thb,
        SUM(CASE WHEN category = 'TRIP' AND currency = 'LAK' THEN amount ELSE 0 END) as total_trip_lak,
        SUM(CASE WHEN category = 'TRIP' AND currency = 'USD' THEN amount ELSE 0 END) as total_trip_usd,
        SUM(CASE WHEN category = 'ADMIN' AND (currency = 'THB' OR currency IS NULL) THEN amount ELSE 0 END) as total_admin_thb,
        SUM(CASE WHEN category = 'ADMIN' AND currency = 'LAK' THEN amount ELSE 0 END) as total_admin_lak,
        SUM(CASE WHEN category = 'ADMIN' AND currency = 'USD' THEN amount ELSE 0 END) as total_admin_usd,
        SUM(CASE WHEN currency = 'THB' OR currency IS NULL THEN amount ELSE 0 END) as grand_total_thb,
        SUM(CASE WHEN currency = 'LAK' THEN amount ELSE 0 END) as grand_total_lak,
        SUM(CASE WHEN currency = 'USD' THEN amount ELSE 0 END) as grand_total_usd
      FROM expenses
    `);

    // Get latest exchange rates
    const [[rateTHB_LAK]] = await pool.query(
      `SELECT rate FROM exchange_rates WHERE pair = 'THB_LAK' ORDER BY created_at DESC LIMIT 1`
    );
    const [[rateUSD_THB]] = await pool.query(
      `SELECT rate FROM exchange_rates WHERE pair = 'USD_THB' ORDER BY created_at DESC LIMIT 1`
    );

    res.render('expenses/index', {
      user: req.session.user,
      title: 'จัดการบัญชี/รายจ่าย',
      expenses,
      summary,
      rates: {
        thb_lak: Number(rateTHB_LAK?.rate) || 580,
        usd_thb: Number(rateUSD_THB?.rate) || 36,
      },
      CATEGORY_MAP,
      flash: req.session.flash,
      error: null
    });
    req.session.flash = null;
  } catch (err) {
    console.error('[Expenses.index]', err);
    res.status(500).send('Error loading expenses');
  }
}

export async function newExpense(req, res) {
  try {
    const { trip_id } = req.query;
    let selectedTrip = null;

    if (trip_id) {
      const [[trip]] = await pool.query('SELECT id, trip_no FROM trips WHERE id = ?', [trip_id]);
      selectedTrip = trip;
    }

    // Recent active trips for dropdown
    const [activeTrips] = await pool.query(`
      SELECT id, trip_no, status, direction 
      FROM trips 
      WHERE status NOT IN ('COMPLETED', 'CANCELLED') 
      ORDER BY id DESC LIMIT 20
    `);

    res.render('expenses/new', {
      user: req.session.user,
      title: 'บันทึกรายจ่ายใหม่',
      selectedTrip,
      activeTrips,
      error: null
    });
    req.session.flash = null;
  } catch (err) {
    console.error('[Expenses.newExpense]', err);
    res.status(500).send('Error loading form');
  }
}

export async function create(req, res) {
  try {
    const { category, type, description, amount, currency, paid_by, expense_date, trip_id } = req.body;
    let receipt_image = null;

    if (req.file) {
      receipt_image = `/uploads/expenses/${req.file.filename}`;
    }

    await pool.query(`
      INSERT INTO expenses 
      (category, type, description, amount, currency, paid_by, expense_date, trip_id, receipt_image, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      category,
      type,
      description || null,
      Number(amount) || 0,
      currency || 'THB',
      paid_by || null,
      expense_date || new Date().toISOString().split('T')[0],
      (category === 'TRIP' && trip_id) ? Number(trip_id) : null,
      receipt_image,
      req.session.user.id
    ]);

    req.session.flash = { type: 'success', message: 'บันทึกรายจ่ายเรียบร้อยแล้ว' };

    // If it was added from a trip page, redirect back to that trip
    if (category === 'TRIP' && trip_id && req.body.return_to === 'trip') {
      return res.redirect(`/trips/${trip_id}`);
    }

    res.redirect('/expenses');
  } catch (err) {
    console.error('[Expenses.create]', err);
    req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาดในการบันทึกรายจ่าย' };
    res.redirect('/expenses/new');
  }
}

export async function destroy(req, res) {
  try {
    const { id } = req.params;
    
    // Admins and Managers can delete
    if (!['admin', 'manager'].includes(req.session.user.role)) {
       req.session.flash = { type: 'error', message: 'ไม่มีสิทธิ์ลบรายการ' };
       return res.redirect('/expenses');
    }

    const [[expense]] = await pool.query('SELECT receipt_image, trip_id FROM expenses WHERE id = ?', [id]);
    
    if (expense) {
      if (expense.receipt_image) {
        const filePath = path.join(process.cwd(), 'public', expense.receipt_image);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      await pool.query('DELETE FROM expenses WHERE id = ?', [id]);
      req.session.flash = { type: 'success', message: 'ลบรายการรายจ่ายแล้ว' };
      
      if (req.query.return_to === 'trip' && expense.trip_id) {
         return res.redirect(`/trips/${expense.trip_id}`);
      }
    }
    
    res.redirect('/expenses');
  } catch (err) {
    console.error('[Expenses.destroy]', err);
    req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาดในการลบ' };
    res.redirect('/expenses');
  }
}
