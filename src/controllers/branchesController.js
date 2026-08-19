import pool from '../config/db.js';
import bcrypt from 'bcryptjs';
import { transitionOrder, withTransaction, WorkflowError } from '../services/orderWorkflowService.js';
import { kickNotificationWorker } from '../services/notificationService.js';
import { canManageBranchResource } from '../services/operationalAccessService.js';
import { broadcastOffer } from '../services/riderDispatchService.js';

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

/**
 * Read a numeric form field, falling back only when it is genuinely absent.
 *
 * `Number(x) || fallback` cannot express a zero, because 0 is falsy — which
 * made a free delivery zone impossible to save: entering 0 silently stored the
 * default fee instead. Zone A is now the free launch-promotion tier, so zero
 * has to survive the round trip.
 */
function numField(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
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

  const hubPct    = numField(split_hub_pct, 30);
  const branchPct = numField(split_branch_pct, 70);
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
        numField(zone_a_km, 5), numField(zone_b_km, 10), numField(zone_c_km, 15),
        numField(fee_zone_a, 0), numField(fee_zone_b, 25000), numField(fee_zone_c, 40000),
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

/**
 * Update a branch's delivery zones, fees and revenue split.
 *
 * There was previously no way to change any of this after creation — only
 * status could be toggled — so a branch created with the wrong radius or fee
 * was stuck with it, and a company-wide pricing change (such as making Zone A
 * a free launch zone) could not be applied to branches that already existed.
 */
export async function update(req, res) {
  const { id } = req.params;
  const {
    name, operator_name, phone, email, address,
    province, district, lat, lng,
    zone_a_km, zone_b_km, zone_c_km,
    fee_zone_a, fee_zone_b, fee_zone_c,
    split_plan, split_hub_pct, split_branch_pct,
    notes,
  } = req.body;

  const errors = [];
  if (!name?.trim()) errors.push('ต้องระบุชื่อสาขา');
  if (!operator_name?.trim()) errors.push('ต้องระบุชื่อเจ้าของ');

  const zoneA = numField(zone_a_km, 5);
  const zoneB = numField(zone_b_km, 10);
  const zoneC = numField(zone_c_km, 15);
  // The bands are read as "A up to zoneA, B up to zoneB, C up to zoneC", so an
  // out-of-order set would silently make a band unreachable rather than fail.
  if (!(zoneA < zoneB && zoneB < zoneC)) {
    errors.push(`รัศมีโซนต้องเรียงจากน้อยไปมาก: A (${zoneA}) < B (${zoneB}) < C (${zoneC})`);
  }

  const hubPct    = numField(split_hub_pct, 30);
  const branchPct = numField(split_branch_pct, 70);
  if (Math.abs(hubPct + branchPct - 100) > 0.01) {
    errors.push(`Hub% + Branch% ต้องรวมเป็น 100 (ปัจจุบัน ${hubPct + branchPct})`);
  }

  if (errors.length > 0) {
    req.session.flash = { type: 'error', message: errors.join(' | ') };
    return res.redirect(`/branches/${id}/edit`);
  }

  try {
    const [result] = await pool.query(
      `UPDATE branches SET
         name=?, operator_name=?, phone=?, email=?, address=?,
         province=?, district=?, lat=?, lng=?,
         zone_a_km=?, zone_b_km=?, zone_c_km=?,
         fee_zone_a=?, fee_zone_b=?, fee_zone_c=?,
         split_plan=?, split_hub_pct=?, split_branch_pct=?, notes=?
       WHERE id=?`,
      [
        name.trim(), operator_name.trim(),
        phone || null, email || null, address || null,
        province || null, district || null,
        lat ? Number(lat) : null, lng ? Number(lng) : null,
        zoneA, zoneB, zoneC,
        numField(fee_zone_a, 0), numField(fee_zone_b, 25000), numField(fee_zone_c, 40000),
        split_plan || 'A', hubPct, branchPct,
        notes || null,
        id,
      ]
    );
    if (result.affectedRows === 0) {
      req.session.flash = { type: 'error', message: 'ไม่พบสาขานี้' };
      return res.redirect('/branches');
    }
    // Existing deliveries keep the fee they were quoted at — repricing parcels
    // already in flight would change what a rider and branch were promised
    // after the fact. New zone settings apply to parcels assigned from now on.
    req.session.flash = { type: 'success', message: 'บันทึกการแก้ไขสาขาแล้ว (มีผลกับงานที่รับเข้ามาใหม่)' };
    res.redirect(`/branches/${id}`);
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
    res.redirect(`/branches/${id}/edit`);
  }
}

export async function showEdit(req, res) {
  const [[branch]] = await pool.query('SELECT * FROM branches WHERE id=?', [req.params.id]);
  if (!branch) {
    req.session.flash = { type: 'error', message: 'ไม่พบสาขานี้' };
    return res.redirect('/branches');
  }
  res.render('branches/edit', {
    user: req.session.user,
    title: `แก้ไขสาขา ${branch.name}`,
    branch,
  });
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
  const { name, phone, vehicle_type, vehicle_no, username, password } = req.body;
  if (!canManageBranchResource({
    role: req.session.user?.role,
    sessionBranchId: req.session.user?.branch_id,
    targetBranchId: branch_id,
  })) {
    return res.status(403).render('errors/403', {
      user: req.session.user,
      title: 'Forbidden',
      requiredRoles: ['branch_operator-own-branch'],
    });
  }

  if (!name?.trim() || !phone?.trim() || !username?.trim() || !password) {
    req.session.flash = { type: 'error', message: 'ต้องระบุชื่อ เบอร์โทร Username และ Password ของไรเดอร์' };
    return res.redirect(`/branches/${branch_id}`);
  }
  if (password.length < 8) {
    req.session.flash = { type: 'error', message: 'Password ต้องมีอย่างน้อย 8 ตัวอักษร' };
    return res.redirect(`/branches/${branch_id}`);
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await withTransaction(async (conn) => {
      const [[branch]] = await conn.query(
        "SELECT id FROM branches WHERE id=? AND status='active' FOR UPDATE",
        [branch_id]
      );
      if (!branch) throw new WorkflowError('Branch not found', 404);
      const [userResult] = await conn.query(
        `INSERT INTO users (username, password_hash, role, name, phone, status, branch_id)
         VALUES (?, ?, 'rider', ?, ?, 'active', ?)`,
        [username.trim(), passwordHash, name.trim(), phone.trim(), branch_id]
      );
      await conn.query(
        `INSERT INTO riders (user_id, branch_id, name, phone, vehicle_type, vehicle_no)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userResult.insertId, branch_id, name.trim(), phone.trim(), vehicle_type || 'motorcycle', vehicle_no || null]
      );
    });
    req.session.flash = { type: 'success', message: `เพิ่มไรเดอร์ ${name} และบัญชี ${username} แล้ว` };
  } catch (error) {
    req.session.flash = {
      type: 'error',
      message: error.code === 'ER_DUP_ENTRY' ? 'Username หรือบัญชีไรเดอร์นี้มีอยู่แล้ว' : error.message,
    };
  }
  res.redirect(`/branches/${branch_id}`);
}

export async function updateRiderStatus(req, res) {
  const { id: branch_id, riderId } = req.params;
  const { status } = req.body;
  if (!canManageBranchResource({
    role: req.session.user?.role,
    sessionBranchId: req.session.user?.branch_id,
    targetBranchId: branch_id,
  })) {
    return res.status(403).render('errors/403', {
      user: req.session.user,
      title: 'Forbidden',
      requiredRoles: ['branch_operator-own-branch'],
    });
  }
  if (!['active', 'inactive'].includes(status)) {
    req.session.flash = { type: 'error', message: 'สถานะไรเดอร์ไม่ถูกต้อง' };
    return res.redirect(`/branches/${branch_id}`);
  }
  await withTransaction(async (conn) => {
    const [[rider]] = await conn.query(
      'SELECT id, user_id FROM riders WHERE id=? AND branch_id=? FOR UPDATE',
      [riderId, branch_id]
    );
    if (!rider) throw new WorkflowError('Rider not found in this branch', 404);
    await conn.query('UPDATE riders SET status=? WHERE id=?', [status, riderId]);
    if (rider.user_id) {
      await conn.query(
        'UPDATE users SET status=? WHERE id=? AND role=\'rider\'',
        [status === 'inactive' ? 'inactive' : 'active', rider.user_id]
      );
    }
  });
  res.redirect(`/branches/${branch_id}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-ASSIGN — Core Algorithm
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Which zone a delivery falls in, and what it costs.
 *
 * Zone A is the launch-promotion tier — the short hop a branch will make to win
 * a new customer — so it doubles as the fallback when the distance cannot be
 * measured at all (a receiver who has never sent a location pin and never had a
 * parcel delivered). Quoting the cheapest tier is the only defensible guess
 * there: the alternative was zone 'X' at a zero fee, which read as a broken
 * record on the branch screen and priced the delivery at nothing anyway.
 *
 * 'X' now means one specific thing — measured, and beyond the branch's Zone C
 * radius, so it needs a human to quote it. That is deliberately NOT folded into
 * the Zone A fallback: a receiver known to be 40km out must not be handed the
 * promotional rate just because the promotion is cheap.
 *
 * @param {number|null} distKm  null/NaN when the distance is unknown
 * @param {object} branch       row from `branches` carrying the zone radii and fees
 * @returns {{zone:'A'|'B'|'C'|'X', fee:number, measured:boolean}}
 */
export function resolveDeliveryZone(distKm, branch) {
  const km = Number(distKm);
  // '' must be caught before Number() sees it: Number('') is 0, which would
  // otherwise read as "measured, and standing on the branch's doorstep".
  const unknown = distKm === null || distKm === undefined || distKm === ''
    || !Number.isFinite(km);
  if (unknown) {
    return { zone: 'A', fee: Number(branch.fee_zone_a), measured: false };
  }
  if (km <= Number(branch.zone_a_km)) return { zone: 'A', fee: Number(branch.fee_zone_a), measured: true };
  if (km <= Number(branch.zone_b_km)) return { zone: 'B', fee: Number(branch.fee_zone_b), measured: true };
  if (km <= Number(branch.zone_c_km)) return { zone: 'C', fee: Number(branch.fee_zone_c), measured: true };
  return { zone: 'X', fee: 0, measured: true };
}

/**
 * findNearestBranch — คำนวณสาขาที่ใกล้ที่สุดสำหรับ receiver GPS
 * Returns { branch, zone, fee } หรือ null ถ้าไม่มีสาขาในรัศมี
 */
export async function findNearestBranch(receiverLat, receiverLng, conn = pool) {
  if (!receiverLat || !receiverLng) return null;

  const [branches] = await conn.query(
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
  const { zone, fee } = resolveDeliveryZone(distKm, branch);

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

  const result = await findNearestBranch(order.receiver_lat, order.receiver_lng, conn);
  if (!result) return null; // ไม่มีสาขาในรัศมี
  return assignOrderToBranch(orderId, result.branch.id, conn, result);
}

/**
 * takeBranchCustody — a branch physically unloaded the parcel off the truck.
 *
 * Unlike assignBranchToOrder, which guesses the branch from the RECEIVER's GPS,
 * this pins the order to the branch that actually has the box in hand. Stamping
 * received_at is what tells riderDispatchService the goods are really there, so
 * the job can open to that branch's riders straight away instead of waiting for
 * the BRANCH_RECEIVED scan (which only applies to parcels forwarded on from the
 * main warehouse).
 */
export async function takeBranchCustody(orderId, branchId, conn = pool) {
  const result = await assignOrderToBranch(orderId, branchId, conn);
  await conn.query(
    'UPDATE branch_deliveries SET received_at=NOW() WHERE order_id=? AND branch_id=?',
    [orderId, branchId]
  );
  return result;
}

export async function assignOrderToBranch(orderId, branchId, conn = pool, precomputed = null) {
  const [[order]] = await conn.query('SELECT * FROM orders WHERE id=?', [orderId]);
  const [[branch]] = await conn.query("SELECT * FROM branches WHERE id=? AND status='active'", [branchId]);
  if (!order || !branch) throw new WorkflowError('Order or active branch not found', 404);

  // findNearestBranch already measured the distance when it picked this branch,
  // so trust its answer; otherwise measure against the branch we were handed,
  // and let resolveDeliveryZone decide what an unmeasurable one costs.
  let zone, fee;
  if (precomputed) {
    ({ zone, fee } = { zone: precomputed.zone, fee: Number(precomputed.fee) || 0 });
  } else {
    const canMeasure = order.receiver_lat && order.receiver_lng && branch.lat && branch.lng;
    const distKm = canMeasure
      ? haversineKm(order.receiver_lat, order.receiver_lng, branch.lat, branch.lng)
      : null;
    ({ zone, fee } = resolveDeliveryZone(distKm, branch));
  }

  const hubAmt = fee * (Number(branch.split_hub_pct) / 100);
  const branchAmt = fee * (Number(branch.split_branch_pct) / 100);
  // Always zero today, and deliberately so: riders are paid a salary rather than
  // a cut of the delivery fee, and the branch form requires Hub% + Branch% to
  // total exactly 100. The column is kept rather than dropped because the
  // remainder is the natural place a per-delivery share would land — switching
  // to that model means relaxing that validation to "at most 100", not
  // reworking the settlement maths.
  const riderAmt = fee - hubAmt - branchAmt;
  const deliveryNo = genDeliveryNo(orderId);

  await conn.query(
    'UPDATE orders SET dest_branch_id=?, delivery_zone=?, last_mile_fee=? WHERE id=?',
    [branch.id, zone, fee, orderId]
  );
  await conn.query(
    `INSERT INTO branch_deliveries
       (delivery_no, order_id, branch_id, zone, delivery_fee, hub_amount, branch_amount, rider_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE branch_id=VALUES(branch_id), zone=VALUES(zone),
       delivery_fee=VALUES(delivery_fee), hub_amount=VALUES(hub_amount),
       branch_amount=VALUES(branch_amount), rider_amount=VALUES(rider_amount)`,
    [deliveryNo, orderId, branch.id, zone, fee, hubAmt, branchAmt, riderAmt]
  );

  const [[delivery]] = await conn.query(
    'SELECT id FROM branch_deliveries WHERE delivery_no=?', [deliveryNo]
  );
  if (delivery) {
    const period = new Date().toISOString().slice(0, 7);
    await conn.query(
      `INSERT INTO branch_revenue (branch_id, delivery_id, period_month, type, amount, currency, note)
       SELECT ?, ?, ?, 'delivery_fee', ?, 'LAK', ?
       WHERE NOT EXISTS (
         SELECT 1 FROM branch_revenue WHERE delivery_id=? AND type='delivery_fee'
       )`,
      [branch.id, delivery.id, period, branchAmt, `Order ${order.job_no} Zone ${zone}`, delivery.id]
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
  let branchId = req.session.user?.branch_id;
  if (!branchId && ['admin','manager'].includes(req.session.user?.role)) {
    const requested = Number(req.query.branch_id);
    if (Number.isInteger(requested) && requested > 0) branchId = requested;
    else {
      const [[firstBranch]] = await pool.query("SELECT id FROM branches WHERE status='active' ORDER BY id LIMIT 1");
      branchId = firstBranch?.id || null;
    }
  }
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
  const sessionBranchId = req.session.user?.branch_id;
  const [[bd]] = await pool.query('SELECT * FROM branch_deliveries WHERE id=?', [deliveryId]);
  if (!bd) {
    req.session.flash = { type: 'error', message: 'ไม่พบรายการนี้' };
    return res.redirect('/branch/dashboard');
  }
  if (req.session.user?.role === 'branch_operator' && String(bd.branch_id) !== String(sessionBranchId)) {
    return res.status(403).render('errors/403', { user: req.session.user, title: 'Forbidden', requiredRoles: ['branch_operator'] });
  }

  await withTransaction(async (conn) => {
    const [[rider]] = await conn.query(
      `SELECT id, user_id FROM riders
       WHERE id=? AND branch_id=? AND status='active' FOR UPDATE`,
      [rider_id, bd.branch_id]
    );
    if (!rider?.user_id) throw new WorkflowError('Rider has no active login account', 409);
    const [deliveryUpdate] = await conn.query(
      `UPDATE branch_deliveries SET rider_id=?, status='ASSIGNED', assigned_at=NOW()
       WHERE id=? AND status='PENDING'`,
      [rider_id, deliveryId]
    );
    if (deliveryUpdate.affectedRows !== 1) throw new WorkflowError('Delivery is no longer pending', 409);
    await conn.query(`UPDATE riders SET status='busy' WHERE id=?`, [rider_id]);
    await transitionOrder({
      orderId: bd.order_id,
      toStatus: 'RIDER_ASSIGNED',
      userId: req.session.user.id,
      note: 'Rider assigned by branch',
      source: 'BRANCH_ASSIGN',
      updates: { rider_id: rider.user_id, assigned_at: new Date() },
      connection: conn,
    });
  });
  kickNotificationWorker(bd.order_id);

  req.session.flash = { type: 'success', message: 'มอบหมายไรเดอร์แล้ว' };
  res.redirect('/branch/dashboard');
}

/**
 * POST /branch/deliveries/:deliveryId/broadcast
 * Open the delivery to every active rider in the branch (first-come-first-served).
 */
export async function broadcastDelivery(req, res) {
  const { deliveryId } = req.params;
  const [[bd]] = await pool.query('SELECT * FROM branch_deliveries WHERE id=?', [deliveryId]);
  if (!bd) {
    req.session.flash = { type: 'error', message: 'ไม่พบรายการนี้' };
    return res.redirect('/branch/dashboard');
  }
  if (!canManageBranchResource({
    role: req.session.user?.role,
    sessionBranchId: req.session.user?.branch_id,
    targetBranchId: bd.branch_id,
  })) {
    return res.status(403).render('errors/403', { user: req.session.user, title: 'Forbidden', requiredRoles: ['branch_operator'] });
  }
  if (bd.status !== 'PENDING') {
    req.session.flash = { type: 'error', message: 'รายการนี้ไม่ได้อยู่ในสถานะรอมอบหมายแล้ว' };
    return res.redirect('/branch/dashboard');
  }

  try {
    const result = await broadcastOffer(bd.order_id, { createdBy: req.session.user.id });
    if (result.ok) {
      req.session.flash = result.already
        ? { type: 'success', message: 'งานนี้เปิดรับอยู่แล้ว (ไรเดอร์กำลังเห็นอยู่)' }
        : { type: 'success', message: `กระจายงานให้ไรเดอร์ ${result.riderCount} คนแล้ว (รหัสรับงาน ${result.claimCode})` };
    } else if (result.reason === 'NO_RIDERS') {
      req.session.flash = { type: 'error', message: 'ไม่มีไรเดอร์ที่พร้อมทำงานในสาขานี้' };
    } else if (result.reason === 'NO_BRANCH') {
      req.session.flash = { type: 'error', message: 'ออเดอร์นี้ยังไม่มีสาขาปลายทาง' };
    } else {
      req.session.flash = { type: 'error', message: 'เปิดรับงานไม่สำเร็จ' };
    }
  } catch (e) {
    console.error('[Branch] broadcastDelivery:', e);
    req.session.flash = { type: 'error', message: e.message || 'เกิดข้อผิดพลาด' };
  }
  res.redirect('/branch/dashboard');
}

export async function markDelivered(req, res) {
  const { deliveryId } = req.params;
  const recipientName = String(req.body.recipient_name || '').trim();
  const notes = String(req.body.notes || '').trim();
  const proofPath = req.file ? `/uploads/orders/${req.file.filename}` : null;

  if (!recipientName || recipientName.length > 120 || !proofPath) {
    req.session.flash = { type: 'error', message: 'ต้องระบุชื่อผู้รับและแนบรูปหลักฐาน POD' };
    return res.redirect('/branch/dashboard');
  }

  let orderId = null;
  try {
    const [[delivery]] = await pool.query(
      `SELECT bd.*, o.cod_amount
       FROM branch_deliveries bd
       JOIN orders o ON o.id=bd.order_id
       WHERE bd.id=?`,
      [deliveryId]
    );
    if (!delivery) throw new WorkflowError('Delivery not found', 404);
    if (!canManageBranchResource({
      role: req.session.user?.role,
      sessionBranchId: req.session.user?.branch_id,
      targetBranchId: delivery.branch_id,
    })) {
      throw new WorkflowError('Delivery belongs to another branch', 403, 'WRONG_BRANCH');
    }

    const expectedCod = Number(delivery.cod_amount || 0);
    const collectedCod = Number(req.body.cod_collected_amount || 0);
    if (!Number.isFinite(collectedCod) || collectedCod < 0
        || (expectedCod > 0 && Math.abs(collectedCod - expectedCod) > 0.01)) {
      throw new WorkflowError(`COD must equal ${expectedCod}`, 400, 'COD_MISMATCH');
    }
    orderId = delivery.order_id;

    await withTransaction(async (conn) => {
      const [[lockedDelivery]] = await conn.query(
        `SELECT bd.*, o.status AS order_status, o.cod_amount
         FROM branch_deliveries bd
         JOIN orders o ON o.id=bd.order_id
         WHERE bd.id=? FOR UPDATE`,
        [deliveryId]
      );
      if (!lockedDelivery || !['ASSIGNED', 'PICKED_UP'].includes(lockedDelivery.status)) {
        throw new WorkflowError('Delivery is not ready to complete', 409);
      }
      if (!canManageBranchResource({
        role: req.session.user?.role,
        sessionBranchId: req.session.user?.branch_id,
        targetBranchId: lockedDelivery.branch_id,
      })) {
        throw new WorkflowError('Delivery belongs to another branch', 403, 'WRONG_BRANCH');
      }
      const lockedExpectedCod = Number(lockedDelivery.cod_amount || 0);
      if (lockedExpectedCod !== expectedCod
          || (lockedExpectedCod > 0 && Math.abs(collectedCod - lockedExpectedCod) > 0.01)) {
        throw new WorkflowError(`COD must equal ${lockedExpectedCod}`, 409, 'COD_CHANGED');
      }

      const [deliveryUpdate] = await conn.query(
        `UPDATE branch_deliveries
         SET status='DELIVERED', delivered_at=NOW(), recipient_name=?, proof_image=?, notes=?
         WHERE id=? AND status IN ('ASSIGNED','PICKED_UP')`,
        [recipientName, proofPath, notes || null, deliveryId]
      );
      if (deliveryUpdate.affectedRows !== 1) {
        throw new WorkflowError('Delivery changed; reload and try again', 409);
      }

      if (['RIDER_ASSIGNED', 'RIDER_ACCEPTED'].includes(lockedDelivery.order_status)) {
        await transitionOrder({
          orderId,
          toStatus: 'OUT_FOR_DELIVERY',
          userId: req.session.user.id,
          note: 'Branch supervisor confirmed rider pickup',
          source: 'BRANCH_DELIVERY',
          connection: conn,
        });
      }
      await transitionOrder({
        orderId,
        toStatus: 'DELIVERED',
        userId: req.session.user.id,
        note: `Delivered by branch rider to ${recipientName}`,
        source: 'BRANCH_DELIVERY',
        updates: {
          recipient_name: recipientName,
          pod_photo_url: proofPath,
          delivery_proof_image: proofPath,
          delivered_by: req.session.user.id,
        },
        connection: conn,
      });
      if (lockedExpectedCod > 0) {
        await conn.query(
          `INSERT INTO cod_settlements (order_id, cod_amount, status, collected_at)
           VALUES (?, ?, 'COLLECTED', NOW())
           ON DUPLICATE KEY UPDATE status='COLLECTED', collected_at=NOW(), cod_amount=VALUES(cod_amount)`,
          [orderId, lockedExpectedCod]
        );
        await transitionOrder({
          orderId,
          toStatus: 'COD_COLLECTED',
          userId: req.session.user.id,
          note: `COD ${collectedCod} collected by branch rider`,
          source: 'BRANCH_DELIVERY',
          updates: { cod_collected_amount: collectedCod },
          connection: conn,
          notify: false,
        });
      }
      if (lockedDelivery.rider_id) {
        await conn.query(`UPDATE riders SET status='active' WHERE id=?`, [lockedDelivery.rider_id]);
      }
    });

    kickNotificationWorker(orderId);
    req.session.flash = { type: 'success', message: 'บันทึกส่งสำเร็จ' };
  } catch (error) {
    console.error('[Branch markDelivered]', error);
    req.session.flash = { type: 'error', message: error.message || 'บันทึกการส่งไม่สำเร็จ' };
  }
  res.redirect('/branch/dashboard');
}
