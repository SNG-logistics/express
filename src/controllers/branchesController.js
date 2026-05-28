import pool from '../config/db.js';

// ─── Haversine distance (km) ──────────────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
          * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── DELIVERY NO generator ────────────────────────────────────────────────────
function genDeliveryNo(orderId) {
  const now = new Date();
  const yy  = String(now.getFullYear()).slice(-2);
  const mm  = String(now.getMonth() + 1).padStart(2, '0');
  const dd  = String(now.getDate()).padStart(2, '0');
  return `BD-${yy}${mm}${dd}-${String(orderId).padStart(4, '0')}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN — Branch CRUD
// ══════════════════════════════════════════════════════════════════════════════

export async function list(req, res) {
  try {
    const [branches] = await pool.query(
      `SELECT b.*,
              COUNT(DISTINCT r.id) AS rider_count,
              COUNT(DISTINCT bd.id) AS delivery_count_all,
              SUM(CASE WHEN bd.status = 'PENDING' THEN 1 ELSE 0 END) AS pending_count
       FROM branches b
       LEFT JOIN riders r ON r.branch_id = b.id AND r.status != 'inactive'
       LEFT JOIN branch_deliveries bd ON bd.branch_id = b.id
       GROUP BY b.id
       ORDER BY b.province ASC, b.name ASC`
    );
    res.render('branches/index', {
      user: req.session.user,
      branches,
      title: 'จัดการสาขา',
    });
  } catch (err) {
    console.error('[Branches.list]', err);
    res.status(500).send(err.message);
  }
}

export async function showCreate(req, res) {
  res.render('branches/new', {
    user: req.session.user,
    title: 'เพิ่มสาขาใหม่',
    error: null,
    draft: req.session.branchDraft || null,
  });
  delete req.session.branchDraft;
}

export async function create(req, res) {
  const {
    branch_code, name, operator_name, phone, email, address,
    province, district, lat, lng,
    zone_a_km, zone_b_km, zone_c_km,
    fee_zone_a, fee_zone_b, fee_zone_c,
    split_plan, split_hub_pct, split_branch_pct,
    notes,
  } = req.body;

  const errors = [];
  if (!branch_code?.trim()) errors.push('ต้องระบุรหัสสาขา');
  if (!name?.trim())        errors.push('ต้องระบุชื่อสาขา');
  if (!operator_name?.trim()) errors.push('ต้องระบุชื่อเจ้าของ');

  const hubPct    = Number(split_hub_pct)    || 30;
  const branchPct = Number(split_branch_pct) || 70;
  if (Math.abs(hubPct + branchPct - 100) > 0.01) {
    errors.push(`Hub% + Branch% ต้องรวมเป็น 100 (ปัจจุบัน ${hubPct + branchPct})`);
  }

  if (errors.length > 0) {
    req.session.branchDraft = req.body;
    req.session.flash = { type: 'error', message: errors.join(' | ') };
    return res.redirect('/branches/new');
  }

  try {
    await pool.query(
      `INSERT INTO branches
        (branch_code, name, operator_name, phone, email, address,
         province, district, lat, lng,
         zone_a_km, zone_b_km, zone_c_km,
         fee_zone_a, fee_zone_b, fee_zone_c,
         split_plan, split_hub_pct, split_branch_pct, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        branch_code.trim().toUpperCase(), name.trim(), operator_name.trim(),
        phone || null, email || null, address || null,
        province || null, district || null,
        lat ? Number(lat) : null, lng ? Number(lng) : null,
        Number(zone_a_km) || 5, Number(zone_b_km) || 10, Number(zone_c_km) || 15,
        Number(fee_zone_a) || 15000, Number(fee_zone_b) || 25000, Number(fee_zone_c) || 40000,
        split_plan || 'A', hubPct, branchPct,
        notes || null,
      ]
    );
    req.session.flash = { type: 'success', message: `เพิ่มสาขา ${branch_code} สำเร็จ` };
    res.redirect('/branches');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      req.session.branchDraft = req.body;
      req.session.flash = { type: 'error', message: `รหัสสาขา "${branch_code}" ซ้ำ` };
      return res.redirect('/branches/new');
    }
    req.session.flash = { type: 'error', message: err.message };
    res.redirect('/branches/new');
  }
}

export async function detail(req, res) {
  const { id } = req.params;
  try {
    const [[branch]] = await pool.query('SELECT * FROM branches WHERE id = ?', [id]);
    if (!branch) {
      req.session.flash = { type: 'error', message: 'ไม่พบสาขา' };
      return res.redirect('/branches');
    }

    const [riders] = await pool.query(
      'SELECT * FROM riders WHERE branch_id = ? ORDER BY status ASC, name ASC', [id]
    );

    const [[stats]] = await pool.query(
      `SELECT
         COUNT(*)                                     AS total,
         SUM(status='PENDING')                        AS pending,
         SUM(status='DELIVERED')                      AS delivered,
         SUM(status='FAILED')                         AS failed,
         SUM(CASE WHEN DATE(created_at)=CURDATE() THEN 1 ELSE 0 END) AS today,
         SUM(CASE WHEN DATE_FORMAT(created_at,'%Y-%m')=DATE_FORMAT(NOW(),'%Y-%m')
              THEN delivery_fee ELSE 0 END)           AS month_fee,
         SUM(CASE WHEN DATE_FORMAT(created_at,'%Y-%m')=DATE_FORMAT(NOW(),'%Y-%m')
              THEN branch_amount ELSE 0 END)          AS month_branch_earn
       FROM branch_deliveries WHERE branch_id = ?`, [id]
    );

    const [recentDeliveries] = await pool.query(
      `SELECT bd.*, o.job_no, r.name AS rider_name
       FROM branch_deliveries bd
       JOIN orders o ON o.id = bd.order_id
       LEFT JOIN riders r ON r.id = bd.rider_id
       WHERE bd.branch_id = ?
       ORDER BY bd.created_at DESC LIMIT 20`, [id]
    );

    res.render('branches/detail', {
      user: req.session.user,
      branch, riders, stats, recentDeliveries,
      title: `สาขา ${branch.branch_code} — ${branch.name}`,
    });
  } catch (err) {
    console.error('[Branches.detail]', err);
    res.status(500).send(err.message);
  }
}

export async function updateStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;
  const allowed = ['active', 'inactive', 'suspended'];
  if (!allowed.includes(status)) {
    req.session.flash = { type: 'error', message: 'Invalid status' };
    return res.redirect(`/branches/${id}`);
  }
  await pool.query('UPDATE branches SET status=? WHERE id=?', [status, id]);
  req.session.flash = { type: 'success', message: 'อัปเดตสถานะสาขาแล้ว' };
  res.redirect(`/branches/${id}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// RIDERS — CRUD under branch
// ══════════════════════════════════════════════════════════════════════════════

export async function createRider(req, res) {
  const { id: branch_id } = req.params;
  const { name, phone, vehicle_type, vehicle_no } = req.body;

  if (!name?.trim() || !phone?.trim()) {
    req.session.flash = { type: 'error', message: 'ต้องระบุชื่อและเบอร์โทรไรเดอร์' };
    return res.redirect(`/branches/${branch_id}`);
  }

  await pool.query(
    'INSERT INTO riders (branch_id, name, phone, vehicle_type, vehicle_no) VALUES (?, ?, ?, ?, ?)',
    [branch_id, name.trim(), phone.trim(), vehicle_type || 'motorcycle', vehicle_no || null]
  );
  req.session.flash = { type: 'success', message: `เพิ่มไรเดอร์ ${name} แล้ว` };
  res.redirect(`/branches/${branch_id}`);
}

export async function updateRiderStatus(req, res) {
  const { id: branch_id, riderId } = req.params;
  const { status } = req.body;
  await pool.query(
    'UPDATE riders SET status=? WHERE id=? AND branch_id=?',
    [status, riderId, branch_id]
  );
  res.redirect(`/branches/${branch_id}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-ASSIGN — Core Algorithm
// ══════════════════════════════════════════════════════════════════════════════

/**
 * findNearestBranch — คำนวณสาขาที่ใกล้ที่สุดสำหรับ receiver GPS
 * Returns { branch, zone, fee } หรือ null ถ้าไม่มีสาขาในรัศมี
 */
export async function findNearestBranch(receiverLat, receiverLng) {
  if (!receiverLat || !receiverLng) return null;

  const [branches] = await pool.query(
    `SELECT * FROM branches WHERE status='active' AND lat IS NOT NULL AND lng IS NOT NULL`
  );

  let nearest = null;
  let nearestDist = Infinity;

  for (const branch of branches) {
    const km = haversineKm(receiverLat, receiverLng, branch.lat, branch.lng);
    if (km < nearestDist && km <= branch.zone_c_km) {
      nearestDist = km;
      nearest = { branch, distKm: km };
    }
  }

  if (!nearest) return null;

  const { branch, distKm } = nearest;
  let zone = 'X', fee = 0;
  if (distKm <= branch.zone_a_km)      { zone = 'A'; fee = branch.fee_zone_a; }
  else if (distKm <= branch.zone_b_km) { zone = 'B'; fee = branch.fee_zone_b; }
  else if (distKm <= branch.zone_c_km) { zone = 'C'; fee = branch.fee_zone_c; }

  return { branch, zone, fee, distKm: distKm.toFixed(2) };
}

/**
 * assignBranchToOrder — อัปเดต order + สร้าง branch_delivery record
 * เรียกจาก arriveDestinationWh หรือจาก AT_DEST_WH transition
 */
export async function assignBranchToOrder(orderId, conn = pool) {
  const [[order]] = await conn.query(
    'SELECT * FROM orders WHERE id=?', [orderId]
  );
  if (!order || !order.receiver_lat || !order.receiver_lng) return null;

  const result = await findNearestBranch(order.receiver_lat, order.receiver_lng);
  if (!result) return null; // ไม่มีสาขาในรัศมี

  const { branch, zone, fee } = result;

  // คำนวณ split amount
  const hubAmt    = fee * (branch.split_hub_pct / 100);
  const branchAmt = fee * (branch.split_branch_pct / 100);
  const riderAmt  = fee - hubAmt - branchAmt; // อาจเป็น 0 สำหรับ Plan A

  // อัปเดต order
  await conn.query(
    'UPDATE orders SET dest_branch_id=?, delivery_zone=?, last_mile_fee=? WHERE id=?',
    [branch.id, zone, fee, orderId]
  );

  // สร้าง branch_delivery
  const deliveryNo = genDeliveryNo(orderId);
  await conn.query(
    `INSERT INTO branch_deliveries
      (delivery_no, order_id, branch_id, zone, delivery_fee, hub_amount, branch_amount, rider_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE delivery_fee=VALUES(delivery_fee)`,
    [deliveryNo, orderId, branch.id, zone, fee, hubAmt, branchAmt, riderAmt]
  );

  // บันทึก revenue ledger
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [[bd]] = await conn.query(
    'SELECT id FROM branch_deliveries WHERE delivery_no=?', [deliveryNo]
  );
  if (bd) {
    await conn.query(
      `INSERT INTO branch_revenue (branch_id, delivery_id, period_month, type, amount, currency, note)
       VALUES (?, ?, ?, 'delivery_fee', ?, 'LAK', ?)`,
      [branch.id, bd.id, period, branchAmt, `Order ${order.job_no} Zone ${zone}`]
    );
  }

  return { branch, zone, fee, deliveryNo };
}

// ══════════════════════════════════════════════════════════════════════════════
// JSON API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/branches/nearest?lat=&lng=
 * ใช้ใน order create form — preview สาขาและค่าส่ง
 */
export async function nearestApi(req, res) {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);

  if (isNaN(lat) || isNaN(lng)) {
    return res.json({ branch: null, zone: null, fee: 0 });
  }

  try {
    const result = await findNearestBranch(lat, lng);
    if (!result) return res.json({ branch: null, zone: null, fee: 0, message: 'ไม่มีสาขาในรัศมี 15 กม.' });

    res.json({
      branch: {
        id:   result.branch.id,
        name: result.branch.name,
        code: result.branch.branch_code,
      },
      zone:   result.zone,
      fee:    result.fee,
      distKm: result.distKm,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BRANCH PORTAL — for branch_operator role
// ══════════════════════════════════════════════════════════════════════════════

export async function portalDashboard(req, res) {
  const branchId = req.session.user?.branch_id;
  if (!branchId) {
    req.session.flash = { type: 'error', message: 'ไม่ได้ผูกกับสาขาใด' };
    return res.redirect('/');
  }

  const [[branch]] = await pool.query('SELECT * FROM branches WHERE id=?', [branchId]);

  const [[stats]] = await pool.query(
    `SELECT
       SUM(status='PENDING')    AS pending,
       SUM(status='ASSIGNED')   AS assigned,
       SUM(status='PICKED_UP')  AS picked_up,
       SUM(status='DELIVERED' AND DATE(delivered_at)=CURDATE()) AS today_delivered,
       SUM(CASE WHEN DATE_FORMAT(created_at,'%Y-%m')=DATE_FORMAT(NOW(),'%Y-%m')
            THEN branch_amount ELSE 0 END) AS month_earn
     FROM branch_deliveries WHERE branch_id=?`, [branchId]
  );

  const [queue] = await pool.query(
    `SELECT bd.*, o.job_no, o.cod_amount,
            c.name AS receiver_name, c.phone AS receiver_phone, c.address AS receiver_address
     FROM branch_deliveries bd
     JOIN orders o ON o.id = bd.order_id
     LEFT JOIN customers c ON c.id = o.receiver_id
     WHERE bd.branch_id=? AND bd.status IN ('PENDING','ASSIGNED','PICKED_UP')
     ORDER BY bd.zone ASC, bd.created_at ASC`, [branchId]
  );

  const [riders] = await pool.query(
    'SELECT * FROM riders WHERE branch_id=? AND status != "inactive" ORDER BY status ASC', [branchId]
  );

  res.render('branches/dashboard', {
    user: req.session.user,
    branch, stats, queue, riders,
    title: `สาขา ${branch.name} — Dashboard`,
  });
}

export async function assignRider(req, res) {
  const { deliveryId } = req.params;
  const { rider_id }   = req.body;
  const branchId = req.session.user?.branch_id;

  const [[bd]] = await pool.query(
    'SELECT * FROM branch_deliveries WHERE id=? AND branch_id=?', [deliveryId, branchId]
  );
  if (!bd) {
    req.session.flash = { type: 'error', message: 'ไม่พบรายการนี้' };
    return res.redirect('/branch/dashboard');
  }

  await pool.query(
    `UPDATE branch_deliveries SET rider_id=?, status='ASSIGNED', assigned_at=NOW() WHERE id=?`,
    [rider_id, deliveryId]
  );
  // Mark rider as busy
  await pool.query(`UPDATE riders SET status='busy' WHERE id=?`, [rider_id]);

  // Update order status
  await pool.query(`UPDATE orders SET status='RIDER_ASSIGNED' WHERE id=?`, [bd.order_id]);
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, 'BRANCH_RECEIVED', 'RIDER_ASSIGNED', 'Rider assigned by branch', ?)`,
    [bd.order_id, req.session.user.id]
  );

  req.session.flash = { type: 'success', message: 'มอบหมายไรเดอร์แล้ว' };
  res.redirect('/branch/dashboard');
}

export async function markDelivered(req, res) {
  const { deliveryId } = req.params;
  const { recipient_name, notes } = req.body;
  const branchId = req.session.user?.branch_id;
  const proofPath = req.file ? `/uploads/pod/${req.file.filename}` : null;

  const [[bd]] = await pool.query(
    'SELECT * FROM branch_deliveries WHERE id=? AND branch_id=?', [deliveryId, branchId]
  );
  if (!bd) {
    req.session.flash = { type: 'error', message: 'ไม่พบรายการนี้' };
    return res.redirect('/branch/dashboard');
  }

  await pool.query(
    `UPDATE branch_deliveries
     SET status='DELIVERED', delivered_at=NOW(),
         recipient_name=?, proof_image=?, notes=?
     WHERE id=?`,
    [recipient_name || null, proofPath, notes || null, deliveryId]
  );

  // Free rider
  if (bd.rider_id) {
    await pool.query(`UPDATE riders SET status='active' WHERE id=?`, [bd.rider_id]);
  }

  // Update order status
  const [[order]] = await pool.query('SELECT cod_amount FROM orders WHERE id=?', [bd.order_id]);
  const nextOrderStatus = order?.cod_amount > 0 ? 'COD_COLLECTED' : 'DELIVERED';

  await pool.query(`UPDATE orders SET status=? WHERE id=?`, [nextOrderStatus, bd.order_id]);
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, 'RIDER_ASSIGNED', ?, 'Delivered by branch rider', ?)`,
    [bd.order_id, nextOrderStatus, req.session.user.id]
  );

  req.session.flash = { type: 'success', message: 'บันทึกส่งสำเร็จ' };
  res.redirect('/branch/dashboard');
}
