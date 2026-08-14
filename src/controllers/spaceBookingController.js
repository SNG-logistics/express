/**
 * src/controllers/spaceBookingController.js
 * ร้านฝากส่ง — Space Booking / Partner Freight
 */

import pool from '../config/db.js';

const BOOKING_TRANSITIONS = Object.freeze({
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['LOADED', 'CANCELLED'],
  LOADED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function logBooking(bookingId, fromStatus, toStatus, note, userId) {
  await pool.query(
    `INSERT INTO space_booking_logs (booking_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, ?, ?)`,
    [bookingId, fromStatus || null, toStatus, note || null, userId || null]
  );
}

function generateBookingNo() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `SB-${yy}${mm}${dd}-${seq}`;
}

function generatePartnerCode() {
  const seq = String(Math.floor(Math.random() * 900) + 100);
  return `FP-${seq}`;
}

function calcTotals({ unit_price, quantity, discount, vat_pct }) {
  const p = Number(unit_price) || 0;
  const q = Number(quantity) || 1;
  const d = Number(discount) || 0;
  const v = Number(vat_pct) || 0;
  const subtotal = p * q;
  const total = Math.max(0, subtotal - d);
  const vat_amount = total * (v / 100);
  const grand_total = total + vat_amount;
  return { subtotal, total, vat_amount, grand_total };
}

/**
 * Checks whether attaching `addedWeightKg` more cargo to `tripId` would blow
 * past the truck's max_weight — counting BOTH regular orders already on the
 * trip (trip_orders) AND other space_bookings already on it, since both
 * physically ride the same truck. `excludeBookingId` lets an already-attached
 * booking re-check itself (e.g. weight edited) without double-counting.
 * No-ops (always OK) if the trip has no max_weight set.
 * @returns {Promise<{ok:boolean, message?:string}>}
 */
async function checkTripCapacity(tripId, addedWeightKg, excludeBookingId = null) {
  const [[trip]] = await pool.query('SELECT max_weight FROM trips WHERE id = ?', [tripId]);
  if (!trip || !trip.max_weight) return { ok: true };

  const [[orderLoad]] = await pool.query(
    `SELECT COALESCE(SUM(COALESCE(o.actual_weight,o.declared_weight,o.weight_kg,0)),0) total
     FROM trip_orders t JOIN orders o ON o.id = t.order_id WHERE t.trip_id = ?`,
    [tripId]
  );
  const [[bookingLoad]] = await pool.query(
    `SELECT COALESCE(SUM(total_weight_kg),0) total FROM space_bookings
     WHERE trip_id = ? AND status <> 'CANCELLED' AND id <> ?`,
    [tripId, excludeBookingId || 0]
  );

  const current = Number(orderLoad.total) + Number(bookingLoad.total);
  const added = Number(addedWeightKg) || 0;
  if (current + added > Number(trip.max_weight)) {
    return {
      ok: false,
      message: `น้ำหนักเกินความจุรถ (รถรับได้ ${trip.max_weight} กก. ตอนนี้มีของแล้ว ${current.toFixed(1)} กก. + ที่จะเพิ่ม ${added.toFixed(1)} กก.)`,
    };
  }
  return { ok: true };
}

// ─── GET /freight/partners — รายการพาร์ทเนอร์ ─────────────────────────────────
export async function listPartners(req, res) {
  try {
    const [partners] = await pool.query(
      `SELECT fp.*,
              COUNT(sb.id) AS total_bookings,
              COALESCE(SUM(CASE WHEN sb.status NOT IN ('CANCELLED') THEN sb.grand_total_thb ELSE 0 END), 0) AS total_revenue,
              COALESCE(SUM(CASE WHEN sb.payment_status = 'UNPAID' AND sb.payment_type = 'CREDIT' AND sb.status NOT IN ('CANCELLED') THEN sb.grand_total_thb ELSE 0 END), 0) AS outstanding_credit
       FROM freight_partners fp
       LEFT JOIN space_bookings sb ON sb.partner_id = fp.id
       GROUP BY fp.id
       ORDER BY fp.company_name ASC`
    );
    const flash = req.session.flash || null;
    delete req.session.flash;
    res.render('freight/partners', {
      user: req.session.user,
      title: 'ร้านฝากส่ง — พาร์ทเนอร์',
      partners,
      flash,
    });
  } catch (err) {
    console.error('[SpaceBooking] listPartners:', err);
    res.status(500).render('errors/500', { user: req.session.user, title: 'Error' });
  }
}

// ─── POST /freight/partners — สร้างพาร์ทเนอร์ ─────────────────────────────────
export async function createPartner(req, res) {
  try {
    const {
      company_name, contact_name, phone, line_id, email,
      address, tax_id, business_type, default_unit,
      credit_days, credit_limit_thb, notes
    } = req.body;

    if (!company_name || !contact_name) {
      req.session.flash = { type: 'error', message: 'กรุณากรอกชื่อร้าน และชื่อผู้ติดต่อ' };
      return res.redirect('/freight/partners');
    }

    // Gen unique partner code
    let partner_code, unique = false, attempts = 0;
    while (!unique && attempts < 5) {
      partner_code = generatePartnerCode();
      const [[exist]] = await pool.query('SELECT id FROM freight_partners WHERE partner_code = ?', [partner_code]);
      if (!exist) unique = true;
      attempts++;
    }

    await pool.query(
      `INSERT INTO freight_partners
        (partner_code, company_name, contact_name, phone, line_id, email,
         address, tax_id, business_type, default_unit,
         credit_days, credit_limit_thb, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        partner_code, company_name, contact_name, phone || null, line_id || null, email || null,
        address || null, tax_id || null, business_type || null, default_unit || 'BOX',
        Number(credit_days) || 0, Number(credit_limit_thb) || 0, notes || null,
        req.session.user?.id || null
      ]
    );

    req.session.flash = { type: 'success', message: `เพิ่มร้านฝากส่ง "${company_name}" สำเร็จ (${partner_code})` };
    res.redirect('/freight/partners');
  } catch (err) {
    console.error('[SpaceBooking] createPartner:', err);
    req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาด: ' + err.message };
    res.redirect('/freight/partners');
  }
}

// ─── POST /freight/partners/:id — อัปเดตพาร์ทเนอร์ ───────────────────────────
export async function updatePartner(req, res) {
  try {
    const { id } = req.params;
    const {
      company_name, contact_name, phone, line_id, email,
      address, tax_id, business_type, default_unit,
      credit_days, credit_limit_thb, status, notes
    } = req.body;

    await pool.query(
      `UPDATE freight_partners SET
        company_name=?, contact_name=?, phone=?, line_id=?, email=?,
        address=?, tax_id=?, business_type=?, default_unit=?,
        credit_days=?, credit_limit_thb=?, status=?, notes=?
       WHERE id=?`,
      [
        company_name, contact_name, phone || null, line_id || null, email || null,
        address || null, tax_id || null, business_type || null, default_unit || 'BOX',
        Number(credit_days) || 0, Number(credit_limit_thb) || 0, status || 'active', notes || null,
        id
      ]
    );

    req.session.flash = { type: 'success', message: 'อัปเดตข้อมูลพาร์ทเนอร์สำเร็จ' };
    res.redirect('/freight/partners');
  } catch (err) {
    console.error('[SpaceBooking] updatePartner:', err);
    req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาด: ' + err.message };
    res.redirect('/freight/partners');
  }
}

// ─── GET /freight — รายการ Booking ────────────────────────────────────────────
export async function listBookings(req, res) {
  try {
    const { partner_id, status, payment_status, q } = req.query;

    let sql = `
      SELECT sb.*, fp.company_name AS partner_name, fp.phone AS partner_phone,
             t.trip_no, t.trip_date, t.status AS trip_status
      FROM space_bookings sb
      JOIN freight_partners fp ON fp.id = sb.partner_id
      LEFT JOIN trips t ON t.id = sb.trip_id
      WHERE 1=1
    `;
    const params = [];

    if (partner_id) { sql += ' AND sb.partner_id = ?'; params.push(partner_id); }
    if (status)     { sql += ' AND sb.status = ?';     params.push(status); }
    if (payment_status) { sql += ' AND sb.payment_status = ?'; params.push(payment_status); }
    if (q) {
      sql += ' AND (sb.booking_no LIKE ? OR fp.company_name LIKE ? OR sb.cargo_description LIKE ?)';
      const term = `%${q}%`;
      params.push(term, term, term);
    }

    sql += ' ORDER BY sb.created_at DESC LIMIT 100';

    const [bookings] = await pool.query(sql, params);
    const [partners] = await pool.query('SELECT id, company_name FROM freight_partners WHERE status = "active" ORDER BY company_name');

    // Stats
    const [[stats]] = await pool.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS draft_count,
        SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed_count,
        SUM(CASE WHEN payment_status = 'UNPAID' AND status NOT IN ('CANCELLED') THEN 1 ELSE 0 END) AS unpaid_count,
        COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED') THEN grand_total_thb ELSE 0 END), 0) AS total_revenue,
        COALESCE(SUM(CASE WHEN payment_status = 'UNPAID' AND status NOT IN ('CANCELLED') THEN grand_total_thb ELSE 0 END), 0) AS total_outstanding
      FROM space_bookings
    `);

    const flash = req.session.flash || null;
    delete req.session.flash;

    res.render('freight/index', {
      user: req.session.user,
      title: 'ร้านฝากส่ง — รายการจอง',
      bookings,
      partners,
      stats: stats || {},
      query: req.query,
      flash,
    });
  } catch (err) {
    console.error('[SpaceBooking] listBookings:', err);
    res.status(500).render('errors/500', { user: req.session.user, title: 'Error' });
  }
}

// ─── GET /freight/new — ฟอร์มสร้าง Booking ──────────────────────────────────
export async function showCreateBooking(req, res) {
  try {
    const [partners] = await pool.query(
      'SELECT * FROM freight_partners WHERE status = "active" ORDER BY company_name'
    );
    const [trips] = await pool.query(
      `SELECT id, trip_no, trip_date, direction, driver_name, status
       FROM trips
       WHERE status IN ('PLANNED','IN_TRANSIT')
       ORDER BY trip_date DESC, trip_no DESC
       LIMIT 30`
    );
    res.render('freight/booking-new', {
      user: req.session.user,
      title: 'สร้างการจองพื้นที่',
      partners,
      trips,
    });
  } catch (err) {
    console.error('[SpaceBooking] showCreateBooking:', err);
    res.status(500).render('errors/500', { user: req.session.user, title: 'Error' });
  }
}

// ─── POST /freight — บันทึก Booking ──────────────────────────────────────────
export async function createBooking(req, res) {
  try {
    const {
      partner_id, trip_id, unit_type, unit_label, quantity,
      dim_l_cm, dim_w_cm, dim_h_cm, total_weight_kg,
      cargo_description, unit_price_thb, discount_thb, vat_pct,
      direction, pickup_address, delivery_address,
      payment_type, special_notes
    } = req.body;

    if (!partner_id || !quantity || !unit_price_thb) {
      req.session.flash = { type: 'error', message: 'กรุณากรอกข้อมูลให้ครบ (พาร์ทเนอร์, จำนวน, ราคา)' };
      return res.redirect('/freight/new');
    }

    if (trip_id) {
      const capacity = await checkTripCapacity(Number(trip_id), total_weight_kg);
      if (!capacity.ok) {
        req.session.flash = { type: 'error', message: capacity.message };
        return res.redirect('/freight/new');
      }
    }

    const totals = calcTotals({
      unit_price: unit_price_thb,
      quantity,
      discount: discount_thb,
      vat_pct,
    });

    // Gen unique booking_no
    let booking_no, unique = false, attempts = 0;
    while (!unique && attempts < 5) {
      booking_no = generateBookingNo();
      const [[exist]] = await pool.query('SELECT id FROM space_bookings WHERE booking_no = ?', [booking_no]);
      if (!exist) unique = true;
      attempts++;
    }

    // Credit terms
    let due_date = null;
    if (payment_type === 'CREDIT') {
      const [[partner]] = await pool.query('SELECT credit_days FROM freight_partners WHERE id = ?', [partner_id]);
      if (partner && partner.credit_days > 0) {
        const d = new Date();
        d.setDate(d.getDate() + partner.credit_days);
        due_date = d.toISOString().slice(0, 10);
      }
    }

    const [result] = await pool.query(
      `INSERT INTO space_bookings (
        booking_no, partner_id, trip_id,
        unit_type, unit_label, quantity,
        dim_l_cm, dim_w_cm, dim_h_cm, total_weight_kg,
        cargo_description,
        unit_price_thb, discount_thb, total_amount_thb,
        vat_pct, vat_amount_thb, grand_total_thb,
        direction, pickup_address, delivery_address,
        payment_type, due_date, special_notes, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        booking_no, Number(partner_id), trip_id ? Number(trip_id) : null,
        unit_type || 'BOX', unit_label || null, Number(quantity),
        dim_l_cm || null, dim_w_cm || null, dim_h_cm || null, total_weight_kg || null,
        cargo_description || null,
        Number(unit_price_thb), Number(discount_thb) || 0, totals.total,
        Number(vat_pct) || 0, totals.vat_amount, totals.grand_total,
        direction || 'TH_TO_LA', pickup_address || null, delivery_address || null,
        payment_type || 'PREPAY', due_date, special_notes || null,
        req.session.user?.id || null
      ]
    );

    const newId = result.insertId;
    await logBooking(newId, null, 'DRAFT', 'สร้างการจองใหม่', req.session.user?.id);

    req.session.flash = { type: 'success', message: `สร้างการจอง ${booking_no} สำเร็จ` };
    res.redirect(`/freight/${newId}`);
  } catch (err) {
    console.error('[SpaceBooking] createBooking:', err);
    req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาด: ' + err.message };
    res.redirect('/freight/new');
  }
}

// ─── GET /freight/:id — รายละเอียด Booking ───────────────────────────────────
export async function bookingDetail(req, res) {
  try {
    const { id } = req.params;
    const [[booking]] = await pool.query(
      `SELECT sb.*, fp.company_name AS partner_name, fp.contact_name, fp.phone AS partner_phone,
              fp.line_id, fp.email AS partner_email, fp.address AS partner_address,
              fp.tax_id AS partner_tax_id, fp.credit_days,
              t.trip_no, t.trip_date, t.driver_name, t.vehicle, t.status AS trip_status,
              t.direction AS trip_direction, t.origin_border, t.dest_border
       FROM space_bookings sb
       JOIN freight_partners fp ON fp.id = sb.partner_id
       LEFT JOIN trips t ON t.id = sb.trip_id
       WHERE sb.id = ?`,
      [id]
    );
    if (!booking) {
      req.session.flash = { type: 'error', message: 'ไม่พบรายการจอง' };
      return res.redirect('/freight');
    }
    const [logs] = await pool.query(
      `SELECT sbl.*, u.username
       FROM space_booking_logs sbl
       LEFT JOIN users u ON u.id = sbl.action_by
       WHERE sbl.booking_id = ?
       ORDER BY sbl.action_at ASC`,
      [id]
    );

    const [trips] = await pool.query(
      `SELECT id, trip_no, trip_date, direction, status
       FROM trips WHERE status IN ('PLANNED','IN_TRANSIT')
       ORDER BY trip_date DESC LIMIT 20`
    );

    const flash = req.session.flash || null;
    delete req.session.flash;

    res.render('freight/booking-detail', {
      user: req.session.user,
      title: `การจอง ${booking.booking_no}`,
      booking,
      logs,
      trips,
      flash,
    });
  } catch (err) {
    console.error('[SpaceBooking] bookingDetail:', err);
    res.status(500).render('errors/500', { user: req.session.user, title: 'Error' });
  }
}

// ─── POST /freight/:id/status — เปลี่ยนสถานะ ─────────────────────────────────
export async function updateStatus(req, res) {
  try {
    const { id } = req.params;
    const { new_status, note, trip_id } = req.body;
    const userId = req.session.user?.id;

    const VALID = ['DRAFT','CONFIRMED','LOADED','IN_TRANSIT','COMPLETED','CANCELLED'];
    if (!VALID.includes(new_status)) {
      req.session.flash = { type: 'error', message: 'สถานะไม่ถูกต้อง' };
      return res.redirect(`/freight/${id}`);
    }

    const [[booking]] = await pool.query('SELECT id, status, booking_no, trip_id, total_weight_kg FROM space_bookings WHERE id = ?', [id]);
    if (!booking) {
      req.session.flash = { type: 'error', message: 'ไม่พบรายการจอง' };
      return res.redirect('/freight');
    }
    if (!(BOOKING_TRANSITIONS[booking.status] || []).includes(new_status)) {
      req.session.flash = { type: 'error', message: `ไม่สามารถเปลี่ยน ${booking.status} → ${new_status}` };
      return res.redirect(`/freight/${id}`);
    }

    // Attaching (or re-attaching) to a different trip — re-check capacity.
    if (trip_id && Number(trip_id) !== booking.trip_id) {
      const capacity = await checkTripCapacity(Number(trip_id), booking.total_weight_kg, booking.id);
      if (!capacity.ok) {
        req.session.flash = { type: 'error', message: capacity.message };
        return res.redirect(`/freight/${id}`);
      }
    }

    const updates = { status: new_status };
    if (new_status === 'CONFIRMED') updates.confirmed_by = userId;
    if (new_status === 'CANCELLED') { updates.cancelled_by = userId; if (req.body.cancel_reason) updates.cancel_reason = req.body.cancel_reason; }
    if (trip_id) updates.trip_id = Number(trip_id);

    // Build dynamic SET
    const setCols = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const setVals = [...Object.values(updates), id];
    await pool.query(`UPDATE space_bookings SET ${setCols}, updated_at = NOW() WHERE id = ?`, setVals);
    await logBooking(id, booking.status, new_status, note || null, userId);

    req.session.flash = { type: 'success', message: `${booking.booking_no} → ${new_status}` };
    res.redirect(`/freight/${id}`);
  } catch (err) {
    console.error('[SpaceBooking] updateStatus:', err);
    req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาด: ' + err.message };
    res.redirect(`/freight/${req.params.id}`);
  }
}

// ─── POST /freight/:id/payment — บันทึกการชำระเงิน ───────────────────────────
export async function recordPayment(req, res) {
  try {
    const { id } = req.params;
    const { paid_amount, payment_ref } = req.body;
    const userId = req.session.user?.id;

    const [[booking]] = await pool.query(
      'SELECT id, status, grand_total_thb, paid_amount_thb, booking_no FROM space_bookings WHERE id = ?',
      [id]
    );
    if (!booking) {
      req.session.flash = { type: 'error', message: 'ไม่พบรายการจอง' };
      return res.redirect('/freight');
    }

    const paymentAmount = Number(paid_amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      req.session.flash = { type: 'error', message: 'ยอดชำระต้องมากกว่า 0' };
      return res.redirect(`/freight/${id}`);
    }
    if (['CANCELLED', 'COMPLETED'].includes(booking.status)) {
      req.session.flash = { type: 'error', message: 'ไม่สามารถรับชำระรายการที่ปิดแล้ว' };
      return res.redirect(`/freight/${id}`);
    }

    const newPaid = Number(booking.paid_amount_thb) + paymentAmount;
    if (newPaid > Number(booking.grand_total_thb) + 0.01) {
      req.session.flash = { type: 'error', message: 'ยอดชำระเกินยอดคงเหลือ' };
      return res.redirect(`/freight/${id}`);
    }
    const payStatus = newPaid >= Number(booking.grand_total_thb) ? 'PAID'
      : newPaid > 0 ? 'PARTIAL' : 'UNPAID';

    await pool.query(
      `UPDATE space_bookings SET
        paid_amount_thb = ?, payment_status = ?,
        payment_ref = ?, paid_at = IF(? >= grand_total_thb, NOW(), paid_at),
        updated_at = NOW()
       WHERE id = ?`,
      [newPaid, payStatus, payment_ref || booking.payment_ref, newPaid, id]
    );
    await logBooking(id, booking.status, booking.status, `[PAYMENT] รับชำระ ฿${Number(paid_amount).toLocaleString()} — ${payment_ref || ''}`, userId);

    req.session.flash = { type: 'success', message: `บันทึกรับชำระ ฿${Number(paid_amount).toLocaleString()} สำเร็จ` };
    res.redirect(`/freight/${id}`);
  } catch (err) {
    console.error('[SpaceBooking] recordPayment:', err);
    req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาด: ' + err.message };
    res.redirect(`/freight/${req.params.id}`);
  }
}

// ─── GET /freight/:id/quote — ใบเสนอราคา (print) ────────────────────────────
export async function printQuote(req, res) {
  try {
    const { id } = req.params;
    const [[booking]] = await pool.query(
      `SELECT sb.*, fp.company_name AS partner_name, fp.contact_name, fp.phone AS partner_phone,
              fp.email AS partner_email, fp.address AS partner_address, fp.tax_id AS partner_tax_id
       FROM space_bookings sb
       JOIN freight_partners fp ON fp.id = sb.partner_id
       WHERE sb.id = ?`,
      [id]
    );
    if (!booking) return res.redirect('/freight');

    // stamp quote_no if not yet set
    if (!booking.quote_no) {
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const seq = String(Math.floor(Math.random() * 900) + 100);
      const qno = `QT-${yy}${mm}${dd}-${seq}`;
      await pool.query('UPDATE space_bookings SET quote_no = ?, quote_issued_at = NOW() WHERE id = ?', [qno, id]);
      booking.quote_no = qno;
      booking.quote_issued_at = new Date();
    }

    const [settingRows] = await pool.query('SELECT setting_key, setting_value FROM company_settings');
    const company = Object.fromEntries(settingRows.map(r => [r.setting_key, r.setting_value]));

    res.render('freight/quote-print', {
      layout: false,
      title: `ใบเสนอราคา ${booking.quote_no}`,
      booking,
      company
    });
  } catch (err) {
    console.error('[SpaceBooking] printQuote:', err);
    res.status(500).send('Error: ' + err.message);
  }
}

// ─── GET /freight/:id/invoice — ใบเรียกเก็บเงิน (print) ──────────────────────
export async function printInvoice(req, res) {
  try {
    const { id } = req.params;
    const [[booking]] = await pool.query(
      `SELECT sb.*, fp.company_name AS partner_name, fp.contact_name, fp.phone AS partner_phone,
              fp.email AS partner_email, fp.address AS partner_address, fp.tax_id AS partner_tax_id
       FROM space_bookings sb
       JOIN freight_partners fp ON fp.id = sb.partner_id
       WHERE sb.id = ?`,
      [id]
    );
    if (!booking) return res.redirect('/freight');

    // stamp invoice_no if not yet set
    if (!booking.invoice_no) {
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const seq = String(Math.floor(Math.random() * 900) + 100);
      const ino = `INV-${yy}${mm}${dd}-${seq}`;
      await pool.query('UPDATE space_bookings SET invoice_no = ?, invoice_issued_at = NOW() WHERE id = ?', [ino, id]);
      booking.invoice_no = ino;
      booking.invoice_issued_at = new Date();
    }

    const [settingRows] = await pool.query('SELECT setting_key, setting_value FROM company_settings');
    const company = Object.fromEntries(settingRows.map(r => [r.setting_key, r.setting_value]));

    res.render('freight/invoice-print', {
      layout: false,
      title: `ใบเรียกเก็บเงิน ${booking.invoice_no}`,
      booking,
      company
    });
  } catch (err) {
    console.error('[SpaceBooking] printInvoice:', err);
    res.status(500).send('Error: ' + err.message);
  }
}
