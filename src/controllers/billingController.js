/**
 * billingController.js — Monthly billing statements (net-off against COD)
 *
 * Views this controller renders (owned by the frontend hand-off, not this file):
 *   billing/index  — list of statements + "create statement" form (customer + date range)
 *   billing/show   — one statement's line items, with a "Settle" button when status=OPEN
 *   billing/print  — A4 print layout (layout:false, same convention as orders/print.ejs)
 */
import * as billingModel from '../models/billingModel.js';

export async function index(req, res) {
  try {
    const customerId = req.query.customer_id || null;
    const [statements, creditCustomers] = await Promise.all([
      billingModel.listStatements(customerId),
      billingModel.listCreditCustomers(),
    ]);
    res.render('billing/index', {
      title: 'วางบิลรายเดือน (Billing Statements)',
      statements,
      creditCustomers,
      filterCustomerId: customerId,
      error: null,
    });
  } catch (err) {
    console.error('[Billing.index]', err);
    res.status(500).send('Error loading billing statements: ' + err.message);
  }
}

export async function create(req, res) {
  try {
    const { customer_id, period_start, period_end } = req.body;
    if (!customer_id || !period_start || !period_end) {
      req.session.flash = { type: 'error', message: 'ต้องระบุลูกค้าและช่วงวันที่' };
      return res.redirect('/billing');
    }
    const statement = await billingModel.createStatement({
      customerId: customer_id,
      periodStart: period_start,
      periodEnd: period_end,
      userId: req.session.user?.id,
    });
    req.session.flash = { type: 'success', message: `สร้างใบวางบิล #${statement.id} แล้ว (${statement.items.length} ออเดอร์)` };
    res.redirect(`/billing/${statement.id}`);
  } catch (err) {
    console.error('[Billing.create]', err);
    req.session.flash = { type: 'error', message: err.message };
    res.redirect('/billing');
  }
}

export async function show(req, res) {
  try {
    const statement = await billingModel.getStatement(req.params.id);
    if (!statement) return res.status(404).send('Statement not found');
    res.render('billing/show', { title: `ใบวางบิล #${statement.id}`, statement, error: null });
  } catch (err) {
    console.error('[Billing.show]', err);
    res.status(500).send('Error loading statement: ' + err.message);
  }
}

export async function settle(req, res) {
  try {
    const statement = await billingModel.settleStatement(req.params.id, req.session.user?.id);
    req.session.flash = { type: 'success', message: `ปิดบิล #${statement.id} แล้ว — ${statement.items.length} ออเดอร์ถูกปิด` };
    res.redirect(`/billing/${statement.id}`);
  } catch (err) {
    console.error('[Billing.settle]', err);
    req.session.flash = { type: 'error', message: err.message };
    res.redirect(`/billing/${req.params.id}`);
  }
}

export async function print(req, res) {
  try {
    const statement = await billingModel.getStatement(req.params.id);
    if (!statement) return res.status(404).send('Statement not found');
    res.render('billing/print', { title: `ใบวางบิล #${statement.id}`, statement, layout: false });
  } catch (err) {
    console.error('[Billing.print]', err);
    res.status(500).send('Error printing statement: ' + err.message);
  }
}
