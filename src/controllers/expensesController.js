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
    const { paid_by, trip_id, start_date, end_date } = req.query;

    let whereClauses = [];
    let params = [];

    if (paid_by && paid_by.trim() !== '') {
      whereClauses.push("e.paid_by = ?");
      params.push(paid_by.trim());
    }
    if (trip_id && trip_id.trim() !== '') {
      whereClauses.push("e.trip_id = ?");
      params.push(Number(trip_id));
    }
    if (start_date && start_date.trim() !== '') {
      whereClauses.push("e.expense_date >= ?");
      params.push(start_date.trim());
    }
    if (end_date && end_date.trim() !== '') {
      whereClauses.push("e.expense_date <= ?");
      params.push(end_date.trim());
    }

    const whereStr = whereClauses.length > 0 ? "WHERE " + whereClauses.join(" AND ") : "";

    // 1. Fetch expenses
    const [expenses] = await pool.query(`
      SELECT e.*, u.name as created_by_name, t.trip_no 
      FROM expenses e
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN trips t ON e.trip_id = t.id
      ${whereStr}
      ORDER BY e.expense_date DESC, e.created_at DESC
      LIMIT 500
    `, params);

    // 2. Calculate summaries
    const [[summary]] = await pool.query(`
      SELECT 
        SUM(CASE WHEN e.category = 'CAPITAL' AND (e.currency = 'THB' OR e.currency IS NULL) THEN e.amount ELSE 0 END) as total_capital_thb,
        SUM(CASE WHEN e.category = 'CAPITAL' AND e.currency = 'LAK' THEN e.amount ELSE 0 END) as total_capital_lak,
        SUM(CASE WHEN e.category = 'CAPITAL' AND e.currency = 'USD' THEN e.amount ELSE 0 END) as total_capital_usd,
        SUM(CASE WHEN e.category = 'TRIP' AND (e.currency = 'THB' OR e.currency IS NULL) THEN e.amount ELSE 0 END) as total_trip_thb,
        SUM(CASE WHEN e.category = 'TRIP' AND e.currency = 'LAK' THEN e.amount ELSE 0 END) as total_trip_lak,
        SUM(CASE WHEN e.category = 'TRIP' AND e.currency = 'USD' THEN e.amount ELSE 0 END) as total_trip_usd,
        SUM(CASE WHEN e.category = 'ADMIN' AND (e.currency = 'THB' OR e.currency IS NULL) THEN e.amount ELSE 0 END) as total_admin_thb,
        SUM(CASE WHEN e.category = 'ADMIN' AND e.currency = 'LAK' THEN e.amount ELSE 0 END) as total_admin_lak,
        SUM(CASE WHEN e.category = 'ADMIN' AND e.currency = 'USD' THEN e.amount ELSE 0 END) as total_admin_usd,
        SUM(CASE WHEN e.currency = 'THB' OR e.currency IS NULL THEN e.amount ELSE 0 END) as grand_total_thb,
        SUM(CASE WHEN e.currency = 'LAK' THEN e.amount ELSE 0 END) as grand_total_lak,
        SUM(CASE WHEN e.currency = 'USD' THEN e.amount ELSE 0 END) as grand_total_usd
      FROM expenses e
      ${whereStr}
    `, params);

    // Get latest exchange rates
    const [[rateTHB_LAK]] = await pool.query(
      `SELECT rate FROM exchange_rates WHERE pair = 'THB_LAK' ORDER BY created_at DESC LIMIT 1`
    );
    const [[rateUSD_THB]] = await pool.query(
      `SELECT rate FROM exchange_rates WHERE pair = 'USD_THB' ORDER BY created_at DESC LIMIT 1`
    );

    // Distinct list of payers for filters
    const [payers] = await pool.query(`
      SELECT DISTINCT paid_by 
      FROM expenses 
      WHERE paid_by IS NOT NULL AND paid_by != '' 
      ORDER BY paid_by ASC
    `);

    // Trips for filters
    const [trips] = await pool.query(`
      SELECT id, trip_no 
      FROM trips 
      ORDER BY id DESC 
      LIMIT 200
    `);

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
      payers,
      trips,
      filters: {
        paid_by: paid_by || '',
        trip_id: trip_id || '',
        start_date: start_date || '',
        end_date: end_date || ''
      },
      flash: req.session.flash,
      error: null
    });
    req.session.flash = null;
  } catch (err) {
    console.error('[Expenses.index]', err);
    res.status(500).send('Error loading expenses');
  }
}

export async function exportExcel(req, res) {
  try {
    const { paid_by, trip_id, start_date, end_date } = req.query;

    let whereClauses = [];
    let params = [];

    if (paid_by && paid_by.trim() !== '') {
      whereClauses.push("e.paid_by = ?");
      params.push(paid_by.trim());
    }
    if (trip_id && trip_id.trim() !== '') {
      whereClauses.push("e.trip_id = ?");
      params.push(Number(trip_id));
    }
    if (start_date && start_date.trim() !== '') {
      whereClauses.push("e.expense_date >= ?");
      params.push(start_date.trim());
    }
    if (end_date && end_date.trim() !== '') {
      whereClauses.push("e.expense_date <= ?");
      params.push(end_date.trim());
    }

    const whereStr = whereClauses.length > 0 ? "WHERE " + whereClauses.join(" AND ") : "";

    // Fetch expenses
    const [expenses] = await pool.query(`
      SELECT e.*, u.name as created_by_name, t.trip_no 
      FROM expenses e
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN trips t ON e.trip_id = t.id
      ${whereStr}
      ORDER BY e.expense_date DESC, e.created_at DESC
    `, params);

    // Build CSV with UTF-8 BOM
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=expenses_report.csv');
    
    // Write UTF-8 BOM
    res.write('\ufeff');

    // Headers
    const headers = ['วันที่', 'หมวดหมู่', 'ประเภทรายจ่าย', 'รายละเอียด', 'ยอดเงิน', 'สกุลเงิน', 'ผู้จ่าย/นักลงทุน', 'รอบรถ', 'ผู้บันทึก', 'วันที่บันทึก'];
    res.write(headers.map(escapeCSV).join(',') + '\r\n');

    for (const exp of expenses) {
      const categoryLabel = CATEGORY_MAP[exp.category] || exp.category;
      const formattedDate = exp.expense_date ? new Date(exp.expense_date).toISOString().split('T')[0] : '';
      const formattedCreatedAt = exp.created_at ? new Date(exp.created_at).toLocaleString('th-TH') : '';
      
      const row = [
        formattedDate,
        categoryLabel,
        exp.type,
        exp.description || '',
        exp.amount,
        exp.currency,
        exp.paid_by || '',
        exp.trip_no || '',
        exp.created_by_name || '',
        formattedCreatedAt
      ];
      
      res.write(row.map(escapeCSV).join(',') + '\r\n');
    }
    
    res.end();
  } catch (err) {
    console.error('[Expenses.exportExcel]', err);
    res.status(500).send('Error exporting expenses');
  }
}

function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);
  str = str.replace(/"/g, '""');
  if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
    return `"${str}"`;
  }
  return str;
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

// ─── PRINT REPORT (A4 SUMMARY) ────────────────────────────────────────────────
export async function printReport(req, res) {
  try {
    const { paid_by, trip_id, start_date, end_date } = req.query;

    let whereClauses = [];
    let params = [];

    if (paid_by && paid_by.trim() !== '') {
      whereClauses.push("e.paid_by = ?");
      params.push(paid_by.trim());
    }
    if (trip_id && trip_id.trim() !== '') {
      whereClauses.push("e.trip_id = ?");
      params.push(Number(trip_id));
    }
    if (start_date && start_date.trim() !== '') {
      whereClauses.push("e.expense_date >= ?");
      params.push(start_date.trim());
    }
    if (end_date && end_date.trim() !== '') {
      whereClauses.push("e.expense_date <= ?");
      params.push(end_date.trim());
    }

    const whereStr = whereClauses.length > 0 ? "WHERE " + whereClauses.join(" AND ") : "";

    // 1. Fetch expenses
    const [expenses] = await pool.query(`
      SELECT e.*, u.name as created_by_name, t.trip_no 
      FROM expenses e
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN trips t ON e.trip_id = t.id
      ${whereStr}
      ORDER BY e.expense_date ASC, e.created_at ASC
      LIMIT 1000
    `, params);

    // 2. Calculate summaries
    const [[summary]] = await pool.query(`
      SELECT 
        SUM(CASE WHEN e.currency = 'THB' OR e.currency IS NULL THEN e.amount ELSE 0 END) as grand_total_thb,
        SUM(CASE WHEN e.currency = 'LAK' THEN e.amount ELSE 0 END) as grand_total_lak,
        SUM(CASE WHEN e.currency = 'USD' THEN e.amount ELSE 0 END) as grand_total_usd
      FROM expenses e
      ${whereStr}
    `, params);

    // 3. Get latest exchange rates
    const [[rateTHB_LAK]] = await pool.query(
      `SELECT rate FROM exchange_rates WHERE pair = 'THB_LAK' ORDER BY created_at DESC LIMIT 1`
    );
    const [[rateUSD_THB]] = await pool.query(
      `SELECT rate FROM exchange_rates WHERE pair = 'USD_THB' ORDER BY created_at DESC LIMIT 1`
    );
    const rates = {
      thb_lak: Number(rateTHB_LAK?.rate) || 580,
      usd_thb: Number(rateUSD_THB?.rate) || 36,
    };

    // 4. Fetch company settings
    const [settingRows] = await pool.query('SELECT setting_key, setting_value FROM company_settings');
    const company = Object.fromEntries(settingRows.map(r => [r.setting_key, r.setting_value]));

    res.render('expenses/print', {
      layout: false,
      expenses,
      summary: summary || { grand_total_thb: 0, grand_total_lak: 0, grand_total_usd: 0 },
      rates,
      company,
      filters: {
        paid_by: paid_by || '',
        trip_id: trip_id || '',
        start_date: start_date || '',
        end_date: end_date || ''
      },
      CATEGORY_MAP,
      user: req.session.user
    });
  } catch (err) {
    console.error('[Expenses.printReport]', err);
    res.status(500).send('Error generating report: ' + err.message);
  }
}

// ─── P&L PROFIT AND LOSS REPORT ───────────────────────────────────────────────
export async function plReport(req, res) {
  try {
    const { start_date, end_date, group_by, print } = req.query;
    const now = new Date();
    
    // Default dates
    // Default start_date is first day of current month to today
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const todayStr = now.toISOString().split('T')[0];
    
    const start = start_date || firstDayOfMonth;
    const end = end_date || todayStr;
    const groupBy = group_by || 'day'; // 'day', 'month', 'year'

    // 1. Fetch latest exchange rates
    const [[rateTHB_LAK]] = await pool.query(
      `SELECT rate FROM exchange_rates WHERE pair = 'THB_LAK' ORDER BY created_at DESC LIMIT 1`
    );
    const [[rateUSD_THB]] = await pool.query(
      `SELECT rate FROM exchange_rates WHERE pair = 'USD_THB' ORDER BY created_at DESC LIMIT 1`
    );
    const rates = {
      thb_lak: Number(rateTHB_LAK?.rate) || 580,
      usd_thb: Number(rateUSD_THB?.rate) || 36,
    };

    // 2. Fetch orders (revenue) created in range
    const [orders] = await pool.query(`
      SELECT id, job_no, price_amount, price_currency, status, created_at
      FROM orders
      WHERE created_at >= ? AND created_at <= ?
        AND status NOT IN ('CUSTOMS_REJECTED', 'RETURN_TO_SENDER')
      ORDER BY created_at ASC
    `, [start + ' 00:00:00', end + ' 23:59:59']);

    // 3. Fetch expenses (costs) created in range
    const [expenses] = await pool.query(`
      SELECT id, category, type, description, amount, currency, expense_date, trip_id
      FROM expenses
      WHERE expense_date >= ? AND expense_date <= ?
      ORDER BY expense_date ASC
    `, [start, end]);

    // 4. Get company settings
    const [settingRows] = await pool.query('SELECT setting_key, setting_value FROM company_settings');
    const company = Object.fromEntries(settingRows.map(r => [r.setting_key, r.setting_value]));

    // Helper functions for currency conversion
    const convertAmount = (amount, cur) => {
      const amt = Number(amount) || 0;
      let thb = 0;
      let lak = 0;
      if (cur === 'THB' || !cur) {
        thb = amt;
        lak = amt * rates.thb_lak;
      } else if (cur === 'LAK') {
        thb = amt / rates.thb_lak;
        lak = amt;
      } else if (cur === 'USD') {
        thb = amt * rates.usd_thb;
        lak = (amt * rates.usd_thb) * rates.thb_lak;
      } else {
        thb = amt;
        lak = amt * rates.thb_lak;
      }
      return { thb, lak };
    };

    const formatDateKey = (dateVal) => {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return 'N/A';
      
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      
      if (groupBy === 'day') {
        return `${y}-${m}-${day}`;
      } else if (groupBy === 'year') {
        return `${y}`;
      } else {
        return `${y}-${m}`;
      }
    };

    // 5. Aggregate in JS based on groupBy level
    const plData = {}; // key: group key (e.g. '2026-06-02' or '2026-06' or '2026')

    const getGroupObj = (key) => {
      if (!plData[key]) {
        plData[key] = {
          key,
          orderCount: 0,
          revenueThb: 0,
          revenueLak: 0,
          tripCostThb: 0,
          tripCostLak: 0,
          capitalCostThb: 0,
          capitalCostLak: 0,
          adminCostThb: 0,
          adminCostLak: 0,
          otherCostThb: 0,
          otherCostLak: 0,
          totalCostThb: 0,
          totalCostLak: 0,
          netProfitThb: 0,
          netProfitLak: 0,
          marginPct: 0
        };
      }
      return plData[key];
    };

    // Process Revenues (orders)
    for (const order of orders) {
      const key = formatDateKey(order.created_at);
      const g = getGroupObj(key);
      const { thb, lak } = convertAmount(order.price_amount, order.price_currency);
      g.orderCount += 1;
      g.revenueThb += thb;
      g.revenueLak += lak;
    }

    // Process Expenses
    for (const exp of expenses) {
      const key = formatDateKey(exp.expense_date);
      const g = getGroupObj(key);
      const { thb, lak } = convertAmount(exp.amount, exp.currency);

      if (exp.category === 'TRIP') {
        g.tripCostThb += thb;
        g.tripCostLak += lak;
      } else if (exp.category === 'CAPITAL') {
        g.capitalCostThb += thb;
        g.capitalCostLak += lak;
      } else if (exp.category === 'ADMIN') {
        g.adminCostThb += thb;
        g.adminCostLak += lak;
      } else {
        g.otherCostThb += thb;
        g.otherCostLak += lak;
      }

      g.totalCostThb += thb;
      g.totalCostLak += lak;
    }

    // Calculate Nets and margins
    const list = Object.values(plData).sort((a, b) => {
      return a.key.localeCompare(b.key);
    });

    let grandRevenueThb = 0;
    let grandRevenueLak = 0;
    let grandTripCostThb = 0;
    let grandTripCostLak = 0;
    let grandCapitalCostThb = 0;
    let grandCapitalCostLak = 0;
    let grandAdminCostThb = 0;
    let grandAdminCostLak = 0;
    let grandOtherCostThb = 0;
    let grandOtherCostLak = 0;
    let grandTotalCostThb = 0;
    let grandTotalCostLak = 0;
    let grandOrderCount = 0;

    for (const g of list) {
      g.netProfitThb = g.revenueThb - g.totalCostThb;
      g.netProfitLak = g.revenueLak - g.totalCostLak;
      g.marginPct = g.revenueThb > 0 ? (g.netProfitThb / g.revenueThb) * 100 : 0;

      // Add to grand totals
      grandRevenueThb += g.revenueThb;
      grandRevenueLak += g.revenueLak;
      grandTripCostThb += g.tripCostThb;
      grandTripCostLak += g.tripCostLak;
      grandCapitalCostThb += g.capitalCostThb;
      grandCapitalCostLak += g.capitalCostLak;
      grandAdminCostThb += g.adminCostThb;
      grandAdminCostLak += g.adminCostLak;
      grandOtherCostThb += g.otherCostThb;
      grandOtherCostLak += g.otherCostLak;
      grandTotalCostThb += g.totalCostThb;
      grandTotalCostLak += g.totalCostLak;
      grandOrderCount += g.orderCount;
    }

    const grandNetProfitThb = grandRevenueThb - grandTotalCostThb;
    const grandNetProfitLak = grandRevenueLak - grandTotalCostLak;
    const grandMarginPct = grandRevenueThb > 0 ? (grandNetProfitThb / grandRevenueThb) * 100 : 0;

    const summary = {
      orderCount: grandOrderCount,
      revenueThb: grandRevenueThb,
      revenueLak: grandRevenueLak,
      tripCostThb: grandTripCostThb,
      tripCostLak: grandTripCostLak,
      capitalCostThb: grandCapitalCostThb,
      capitalCostLak: grandCapitalCostLak,
      adminCostThb: grandAdminCostThb,
      adminCostLak: grandAdminCostLak,
      otherCostThb: grandOtherCostThb,
      otherCostLak: grandOtherCostLak,
      totalCostThb: grandTotalCostThb,
      totalCostLak: grandTotalCostLak,
      netProfitThb: grandNetProfitThb,
      netProfitLak: grandNetProfitLak,
      marginPct: grandMarginPct
    };

    const renderData = {
      user: req.session.user,
      title: 'รายงานกำไร-ขาดทุน (P&L)',
      list,
      summary,
      rates,
      company,
      filters: {
        start_date: start,
        end_date: end,
        group_by: groupBy
      }
    };

    if (print === '1' || print === 'true') {
      res.render('expenses/pl_print', {
        layout: false,
        ...renderData
      });
    } else {
      res.render('expenses/pl', renderData);
    }

  } catch (err) {
    console.error('[Expenses.plReport]', err);
    res.status(500).send('Error generating P&L report: ' + err.message);
  }
}
