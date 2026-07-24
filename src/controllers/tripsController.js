/**
 * src/controllers/tripsController.js — v2
 *
 * Main changes vs v1:
 * - list()        : adds driver_name, vehicle, direction, order_count
 * - showCreate()  : filters availableOrders by direction match, adds weight/cod summary
 * - create()      : uses 'ON_TRUCK' (not ON_TRUCK_BORDER), correct status; auto trip_no
 * - detail()      : adds cargo totals (freight, cod, weight, count); adds status history
 * - attachOrders(): transitions to ON_TRUCK (correct status)
 * - detachOrder() : NEW — remove single order from trip (if trip still PLANNED/LOADING)
 * - updateStatus(): expands mapping, auto orders cascade
 */

import pool from '../config/db.js';

// ─── Allowed trip status transitions ─────────────────────────────────────────
const TRIP_TRANSITIONS = {
  'PLANNED':   ['LOADING'],
  'LOADING':   ['DEPARTED', 'PLANNED'],  // allow rollback to PLANNED if no orders moved yet
  'DEPARTED':  ['AT_BORDER'],
  'AT_BORDER': ['CROSSED'],
  'CROSSED':   ['ARRIVED'],
  'ARRIVED':   ['UNLOADING'],
  'UNLOADING': ['COMPLETED'],
  'COMPLETED': [],
  'CANCELLED': [],
};

// Order status that gets set when trip advances
const TRIP_TO_ORDER_STATUS = {
  'LOADING':   'ON_TRUCK',
  'DEPARTED':  'ON_TRUCK_BORDER',
  'AT_BORDER': 'CROSSING_BORDER',
  'CROSSED':   'ARRIVED_BORDER_WH'
  // When Trip is ARRIVED or UNLOADING, we do NOT auto-cascade to AT_DEST_WH
  // so that the destination warehouse is forced to use the Unload Scanner.
};

const TRIP_STATUS_LABELS = {
  'PLANNED':   'วางแผนแล้ว',
  'LOADING':   'กำลังโหลด',
  'DEPARTED':  'ออกแล้ว',
  'AT_BORDER': 'ที่ด่าน',
  'CROSSED':   'ข้ามแดนแล้ว',
  'ARRIVED':   'ถึงคลังปลาย',
  'UNLOADING': 'กำลังขนลง',
  'COMPLETED': 'เสร็จสิ้น',
  'CANCELLED': 'ยกเลิก',
};

async function logStatus(orderId, fromStatus, toStatus, note, userId) {
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, ?, ?)`,
    [orderId, fromStatus || null, toStatus, note, userId || null]
  );
}

// ─── LIST ─────────────────────────────────────────────────────────────────────
export async function list(req, res) {
  const { filter = 'active', direction = '' } = req.query;

  let where = filter === 'completed'
    ? "WHERE t.status IN ('COMPLETED','CANCELLED')"
    : "WHERE t.status NOT IN ('COMPLETED','CANCELLED')";
  const params = [];
  if (direction) {
    where += ' AND t.direction = ?';
    params.push(direction);
  }

  const [trips] = await pool.query(`
    SELECT t.id, t.trip_no, t.trip_date, t.status, t.direction,
           t.origin_border, t.dest_border, t.driver_name, t.vehicle, t.max_weight,
           COUNT(to2.order_id)              AS order_count,
           COALESCE(SUM(o.declared_weight),0) AS total_weight,
           COALESCE(SUM(o.price_amount),0)    AS total_freight,
           COALESCE(SUM(o.cod_amount),0)      AS total_cod,
           SUM(CASE WHEN o.requires_customs=1 THEN 1 ELSE 0 END) AS customs_count
    FROM trips t
    LEFT JOIN trip_orders to2 ON to2.trip_id = t.id
    LEFT JOIN orders o  ON o.id = to2.order_id
    ${where}
    GROUP BY t.id
    ORDER BY t.trip_date DESC
    LIMIT 100
  `, params);

  res.render('trips/list', {
    trips,
    title: 'รอบรถ',
    query: req.query,
  });
}

// ─── SHOW CREATE ──────────────────────────────────────────────────────────────
export async function showCreate(req, res) {
  const { direction = '' } = req.query;

  // Available orders: not assigned to any active trip, right direction, WH received
  let sql = `
    SELECT o.id, o.job_no, o.direction, o.status,
           o.price_amount, o.cod_amount, o.declared_weight,
           s.name AS sender_name, r.name AS receiver_name
    FROM orders o
    LEFT JOIN customers s ON s.id = o.sender_id
    LEFT JOIN customers r ON r.id = o.receiver_id
    WHERE o.id NOT IN (
      SELECT to2.order_id FROM trip_orders to2
      JOIN trips t ON t.id = to2.trip_id
      WHERE t.status NOT IN ('COMPLETED','CANCELLED')
    )
    AND o.status IN ('RECEIVED_WH_TH','RECEIVED_WH_LA','NEW')
  `;
  const params = [];
  if (direction) {
    sql += ' AND o.direction = ?';
    params.push(direction);
  }
  sql += ' ORDER BY o.created_at ASC';

  const [availableOrders] = await pool.query(sql, params);

  // Generate auto trip_no suggestion: TR-YYMMDD-NN
  const now   = new Date();
  const yy    = String(now.getFullYear()).slice(-2);
  const mm    = String(now.getMonth() + 1).padStart(2, '0');
  const dd    = String(now.getDate()).padStart(2, '0');
  const [[lastTrip]] = await pool.query(
    `SELECT trip_no FROM trips WHERE trip_no LIKE ? ORDER BY id DESC LIMIT 1`,
    [`TR-${yy}${mm}${dd}-%`]
  );
  let nextSeq = 1;
  if (lastTrip) {
    const parts = lastTrip.trip_no.split('-');
    nextSeq = (parseInt(parts[parts.length - 1], 10) || 0) + 1;
  }
  const suggestedTripNo = `TR-${yy}${mm}${dd}-${String(nextSeq).padStart(2, '0')}`;

  res.render('trips/new', {
    title: 'สร้างรอบรถ',
    availableOrders,
    suggestedTripNo,
    direction,
    error: null,
  });
}

// ─── CREATE ───────────────────────────────────────────────────────────────────
export async function create(req, res) {
  const {
    trip_no, trip_date, direction,
    origin_border, dest_border, border_checkpoint,
    vehicle, driver_name,
    max_weight, notes,
    order_ids = [],
    initial_status = 'PLANNED',
  } = req.body;

  if (!trip_no || !trip_date || !direction || !border_checkpoint) {
    return res.render('trips/new', {
      title: 'สร้างรอบรถ',
      availableOrders: [],
      suggestedTripNo: trip_no || '',
      direction: direction || '',
      error: 'กรอกข้อมูลที่จำเป็น: Trip No, วันที่, ทิศทาง, จุดผ่านแดน',
    });
  }

  try {
    // Check duplicate trip_no
    const [[existing]] = await pool.query('SELECT id FROM trips WHERE trip_no = ?', [trip_no]);
    if (existing) {
      throw new Error(`Trip No "${trip_no}" ถูกใช้แล้ว`);
    }

    const tripStatus = initial_status === 'COMPLETED' ? 'COMPLETED' : 'PLANNED';

    const [result] = await pool.query(
      `INSERT INTO trips (trip_no, trip_date, direction, origin_border, dest_border, border_checkpoint, vehicle, driver_name, notes, max_weight, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [trip_no, trip_date, direction, origin_border || null, dest_border || null, border_checkpoint,
       vehicle || null, driver_name || null, notes || null,
       max_weight ? Number(max_weight) : null, tripStatus]
    );
    const tripId = result.insertId;

    // Attach orders
    const ordersArray = (Array.isArray(order_ids) ? order_ids : [order_ids]).filter(Boolean);
    if (ordersArray.length > 0) {
      const numericIds = ordersArray.map(Number).filter(n => !isNaN(n));
      if (numericIds.length > 0) {
        const [currentRows] = await pool.query(
          `SELECT id, status FROM orders WHERE id IN (${numericIds.map(() => '?').join(',')})`,
          numericIds
        );
        const statusById = Object.fromEntries(currentRows.map(o => [o.id, o.status]));

        // Insert trip_orders
        const vals = numericIds.map(() => '(?,?)').join(',');
        await pool.query(
          `INSERT IGNORE INTO trip_orders (trip_id, order_id) VALUES ${vals}`,
          numericIds.flatMap(oid => [tripId, oid])
        );

        // Update order status to DELIVERED if trip completed, else ON_TRUCK
        if (tripStatus === 'COMPLETED') {
          await pool.query(
            `UPDATE orders SET status = 'DELIVERED', delivered_at = NOW(), trip_id = ? WHERE id IN (${numericIds.map(() => '?').join(',')})`,
            [tripId, ...numericIds]
          );
        } else {
          await pool.query(
            `UPDATE orders SET status = 'ON_TRUCK', trip_id = ? WHERE id IN (${numericIds.map(() => '?').join(',')})`,
            [tripId, ...numericIds]
          );
        }

        // Status logs
        const targetOrderStatus = tripStatus === 'COMPLETED' ? 'DELIVERED' : 'ON_TRUCK';
        for (const oid of numericIds) {
          await logStatus(oid, statusById[oid] || null, targetOrderStatus,
            tripStatus === 'COMPLETED' ? `ผูกรอบรถย้อนหลัง ${trip_no} (สถานะสำเร็จ)` : `ผูกรอบรถ ${trip_no}`, req.session.user?.id);
        }
      }
    }

    req.session.flash = { type: 'success', message: `สร้างรอบรถ ${trip_no} สำเร็จ` };
    res.redirect(`/trips/${tripId}`);
  } catch (err) {
    console.error('[Trip create]', err);
    const [availableOrders] = await pool.query(`
      SELECT o.id, o.job_no, o.direction, o.status, o.price_amount, o.cod_amount,
             o.declared_weight, s.name AS sender_name, r.name AS receiver_name
      FROM orders o
      LEFT JOIN customers s ON s.id = o.sender_id
      LEFT JOIN customers r ON r.id = o.receiver_id
      WHERE o.id NOT IN (
        SELECT to2.order_id FROM trip_orders to2
        JOIN trips t ON t.id = to2.trip_id WHERE t.status NOT IN ('COMPLETED','CANCELLED')
      )
      AND o.status IN ('RECEIVED_WH_TH','RECEIVED_WH_LA','NEW')
      ORDER BY o.created_at ASC
    `);
    res.render('trips/new', {
      title: 'สร้างรอบรถ',
      availableOrders,
      suggestedTripNo: trip_no || '',
      direction: direction || '',
      error: err.message,
    });
  }
}

// ─── DETAIL ───────────────────────────────────────────────────────────────────
export async function detail(req, res) {
  const { id } = req.params;
  const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [id]);
  if (!trip) {
    req.session.flash = { type: 'error', message: 'ไม่พบรอบรถ' };
    return res.redirect('/trips');
  }

  const [tripOrders] = await pool.query(`
    SELECT o.id, o.job_no, o.direction, o.status,
           o.price_amount, o.cod_amount, o.declared_weight,
           o.requires_customs,
           s.name AS sender_name, s.phone AS sender_phone,
           r.name AS receiver_name, r.phone AS receiver_phone
    FROM trip_orders to2
    JOIN orders o ON o.id = to2.order_id
    LEFT JOIN customers s ON s.id = o.sender_id
    LEFT JOIN customers r ON r.id = o.receiver_id
    WHERE to2.trip_id = ?
    ORDER BY o.created_at ASC
  `, [id]);

  // Cargo totals
  const totals = tripOrders.reduce((acc, o) => ({
    freight:  acc.freight  + Number(o.price_amount  || 0),
    cod:      acc.cod      + Number(o.cod_amount     || 0),
    weight:   acc.weight   + Number(o.declared_weight|| 0),
    customs:  acc.customs  + (o.requires_customs ? 1 : 0),
    count:    acc.count    + 1,
  }), { freight: 0, cod: 0, weight: 0, customs: 0, count: 0 });

  // Capacity % (if max_weight set)
  totals.capacityPct = trip.max_weight > 0
    ? Math.min(100, Math.round(totals.weight / trip.max_weight * 100))
    : null;

  // Available orders (same direction, not yet in any active trip)
  const [availableOrders] = await pool.query(`
    SELECT o.id, o.job_no, o.direction, o.status,
           o.price_amount, o.cod_amount, o.declared_weight,
           s.name AS sender_name, r.name AS receiver_name
    FROM orders o
    LEFT JOIN customers s ON s.id = o.sender_id
    LEFT JOIN customers r ON r.id = o.receiver_id
    WHERE o.id NOT IN (
      SELECT to2.order_id FROM trip_orders to2
      JOIN trips t ON t.id = to2.trip_id WHERE t.status NOT IN ('COMPLETED','CANCELLED')
    )
    AND o.status IN ('RECEIVED_WH_TH','RECEIVED_WH_LA','NEW')
    AND o.direction = ?
    ORDER BY o.created_at ASC
  `, [trip.direction || 'TH_TO_LA']);

  // Status log (last 10 events across all orders in trip)
  const [tripLogs] = await pool.query(`
    SELECT osl.order_id, osl.from_status, osl.to_status, osl.note, osl.action_at,
           o.job_no, u.username AS action_by_name
    FROM order_status_logs osl
    JOIN orders o ON o.id = osl.order_id
    LEFT JOIN users u ON u.id = osl.action_by
    WHERE osl.order_id IN (SELECT order_id FROM trip_orders WHERE trip_id = ?)
    ORDER BY osl.action_at DESC
    LIMIT 15
  `, [id]);

  // Query actual expenses for this trip
  const [tripExpenses] = await pool.query(`
    SELECT e.*, u.name as created_by_name 
    FROM expenses e
    LEFT JOIN users u ON e.created_by = u.id
    WHERE e.trip_id = ?
    ORDER BY e.expense_date ASC, e.id ASC
  `, [id]);

  const expensesSummary = tripExpenses.reduce((acc, exp) => {
    const cur = exp.currency || 'THB';
    const amt = Number(exp.amount) || 0;
    acc[cur] = (acc[cur] || 0) + amt;
    return acc;
  }, { THB: 0, LAK: 0, USD: 0 });

  // Get latest exchange rates
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

  // Next allowed statuses for this trip
  const nextStatuses = TRIP_TRANSITIONS[trip.status] || [];

  res.render('trips/detail', {
    title: `รอบรถ ${trip.trip_no}`,
    trip,
    tripOrders,
    totals,
    availableOrders,
    tripLogs,
    tripExpenses,
    expensesSummary,
    rates,
    nextStatuses,
    STATUS_LABELS: TRIP_STATUS_LABELS,
    error: null,
  });
}

// ─── ATTACH ORDERS ────────────────────────────────────────────────────────────
export async function attachOrders(req, res) {
  const { id } = req.params;
  const { order_ids = [] } = req.body;

  const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [id]);
  if (!trip) return res.redirect('/trips');

  if (!['PLANNED','LOADING'].includes(trip.status)) {
    req.session.flash = { type: 'error', message: 'รอบรถออกแล้ว — ไม่สามารถเพิ่มออเดอร์ได้' };
    return res.redirect(`/trips/${id}`);
  }

  const ordersArray = (Array.isArray(order_ids) ? order_ids : [order_ids]).filter(Boolean);
  if (!ordersArray.length) return res.redirect(`/trips/${id}`);

  const numericIds = ordersArray.map(Number).filter(n => !isNaN(n));
  if (!numericIds.length) return res.redirect(`/trips/${id}`);

  try {
    const [currentRows] = await pool.query(
      `SELECT id, status FROM orders WHERE id IN (${numericIds.map(() => '?').join(',')})`,
      numericIds
    );
    const statusById = Object.fromEntries(currentRows.map(o => [o.id, o.status]));

    const vals = numericIds.map(() => '(?,?)').join(',');
    await pool.query(
      `INSERT IGNORE INTO trip_orders (trip_id, order_id) VALUES ${vals}`,
      numericIds.flatMap(oid => [id, oid])
    );
    await pool.query(
      `UPDATE orders SET status = 'ON_TRUCK', trip_id = ? WHERE id IN (${numericIds.map(() => '?').join(',')})`,
      [id, ...numericIds]
    );
    for (const oid of numericIds) {
      await logStatus(oid, statusById[oid] || null, 'ON_TRUCK',
        `เพิ่มเข้ารอบรถ ${trip.trip_no}`, req.session.user?.id);
    }

    req.session.flash = { type: 'success', message: `เพิ่ม ${numericIds.length} ออเดอร์สำเร็จ` };
    res.redirect(`/trips/${id}`);
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
    res.redirect(`/trips/${id}`);
  }
}

// ─── DETACH ORDER (NEW) ───────────────────────────────────────────────────────
export async function detachOrder(req, res) {
  const { id, orderId } = req.params;

  const [[trip]]  = await pool.query('SELECT * FROM trips WHERE id = ?', [id]);
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);

  if (!trip || !order) {
    req.session.flash = { type: 'error', message: 'ไม่พบรอบรถหรือออเดอร์' };
    return res.redirect(`/trips/${id}`);
  }
  if (!['PLANNED','LOADING'].includes(trip.status)) {
    req.session.flash = { type: 'error', message: 'รอบรถออกแล้ว — ไม่สามารถถอดออเดอร์ได้' };
    return res.redirect(`/trips/${id}`);
  }

  await pool.query('DELETE FROM trip_orders WHERE trip_id = ? AND order_id = ?', [id, orderId]);
  await pool.query(`UPDATE orders SET trip_id = NULL, status = 'RECEIVED_WH_TH' WHERE id = ?`, [orderId]);
  await logStatus(orderId, order.status, 'RECEIVED_WH_TH',
    `ถอดออกจากรอบรถ ${trip.trip_no}`, req.session.user?.id);

  req.session.flash = { type: 'success', message: `ถอดออเดอร์ ${order.job_no} ออกจากรอบรถแล้ว` };
  res.redirect(`/trips/${id}`);
}

// ─── UPDATE STATUS ────────────────────────────────────────────────────────────
export async function updateStatus(req, res) {
  const { id } = req.params;
  const { status, note } = req.body;

  try {
    const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [id]);
    if (!trip) return res.status(404).send('Trip not found');

    const nextAllowed = TRIP_TRANSITIONS[trip.status] || [];
    if (!nextAllowed.includes(status)) {
      req.session.flash = {
        type: 'error',
        message: `ไม่สามารถเปลี่ยนสถานะจาก "${trip.status}" → "${status}"`,
      };
      return res.redirect(`/trips/${id}`);
    }
    
    // Vehicle/Driver Validation before DEPARTED
    if (status === 'DEPARTED') {
      if (!trip.vehicle || !trip.driver_name) {
        req.session.flash = {
          type: 'error',
          message: 'กรุณาระบุทะเบียนรถและชื่อคนขับ (กดปุ่มแก้ไข) ก่อนออกรถ',
        };
        return res.redirect(`/trips/${id}`);
      }
    }

    await pool.query('UPDATE trips SET status = ? WHERE id = ?', [status, id]);

    // Auto-cascade order status
    const toOrderStatus = TRIP_TO_ORDER_STATUS[status];
    if (toOrderStatus) {
      const [tripOrders] = await pool.query(
        'SELECT order_id FROM trip_orders WHERE trip_id = ?', [id]
      );
      const orderIds = tripOrders.map(t => t.order_id);

      if (orderIds.length > 0) {
        const ph = orderIds.map(() => '?').join(',');
        const [currentRows] = await pool.query(
          `SELECT id, status FROM orders WHERE id IN (${ph})`, orderIds
        );
        await pool.query(
          `UPDATE orders SET status = ? WHERE id IN (${ph})`, [toOrderStatus, ...orderIds]
        );
        for (const row of currentRows) {
          await logStatus(row.id, row.status, toOrderStatus,
            `Trip ${trip.trip_no} → ${status}${note ? ': ' + note : ''}`,
            req.session.user?.id);
        }
      }
    }

    req.session.flash = {
      type: 'success',
      message: `อัปเดตรอบรถเป็น "${TRIP_STATUS_LABELS[status] || status}" สำเร็จ`,
    };
    res.redirect(`/trips/${id}`);
  } catch (err) {
    console.error('[Trip updateStatus]', err);
    req.session.flash = { type: 'error', message: err.message };
    res.redirect(`/trips/${id}`);
  }
}

// ─── QUICK EDIT (driver / vehicle / notes inline) ────────────────────────────
export async function quickEdit(req, res) {
  const { id } = req.params;
  const { driver_name, vehicle, notes, max_weight, border_checkpoint } = req.body;

  const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [id]);
  if (!trip) {
    req.session.flash = { type: 'error', message: 'ไม่พบรอบรถ' };
    return res.redirect('/trips');
  }
  if (['COMPLETED','CANCELLED'].includes(trip.status)) {
    req.session.flash = { type: 'error', message: 'รอบรถปิดแล้ว — ไม่สามารถแก้ไขได้' };
    return res.redirect(`/trips/${id}`);
  }

  await pool.query(
    `UPDATE trips SET driver_name = ?, vehicle = ?, notes = ?, max_weight = ?, border_checkpoint = ? WHERE id = ?`,
    [
      driver_name || trip.driver_name,
      vehicle     || trip.vehicle,
      notes       ?? trip.notes,
      max_weight  ? Number(max_weight) : trip.max_weight,
      border_checkpoint || trip.border_checkpoint,
      id,
    ]
  );

  req.session.flash = { type: 'success', message: 'อัปเดตข้อมูลรอบรถสำเร็จ' };
  res.redirect(`/trips/${id}`);
}

// ─── MANIFEST ─────────────────────────────────────────────────────────────────
export async function printManifest(req, res) {
  const { id } = req.params;
  const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [id]);
  if (!trip) return res.status(404).send('Not found');

  const [tripOrders] = await pool.query(`
    SELECT o.*,
           s.name AS sender_name, s.phone AS sender_phone, s.address AS sender_address,
           r.name AS receiver_name, r.phone AS receiver_phone, r.address AS receiver_address
    FROM trip_orders to2
    JOIN orders o ON o.id = to2.order_id
    LEFT JOIN customers s ON s.id = o.sender_id
    LEFT JOIN customers r ON r.id = o.receiver_id
    WHERE to2.trip_id = ?
    ORDER BY o.created_at ASC
  `, [id]);

  const [settingRows] = await pool.query('SELECT setting_key, setting_value FROM company_settings');
  const company = Object.fromEntries(settingRows.map(r => [r.setting_key, r.setting_value]));

  res.render('trips/manifest', {
    layout: false,
    trip,
    tripOrders,
    company
  });
}

// ─── API: active trips (for scanner handoff picker) ──────────────────────────
export async function apiActiveTrips(req, res) {
  try {
    const [trips] = await pool.query(`
      SELECT t.id, t.trip_no, t.status, t.direction, t.driver_name,
             COUNT(to2.order_id) AS order_count
      FROM trips t
      LEFT JOIN trip_orders to2 ON to2.trip_id = t.id
      WHERE t.status IN ('PLANNED','LOADING')
      GROUP BY t.id
      ORDER BY t.trip_date DESC
      LIMIT 20
    `);
    res.json({ trips });
  } catch (err) {
    console.error('[Trip apiActiveTrips]', err);
    res.status(500).json({ trips: [], error: err.message });
  }
}

// ─── API: arriving trips (for scanner unload picker) ─────────────────────────
export async function apiArrivingTrips(req, res) {
  try {
    const [trips] = await pool.query(`
      SELECT t.id, t.trip_no, t.status, t.direction, t.driver_name, t.vehicle,
             COUNT(to2.order_id) AS order_count
      FROM trips t
      LEFT JOIN trip_orders to2 ON to2.trip_id = t.id
      WHERE t.status IN ('ARRIVED','UNLOADING')
      GROUP BY t.id
      ORDER BY t.trip_date DESC
      LIMIT 20
    `);
    res.json({ trips });
  } catch (err) {
    console.error('[Trip apiArrivingTrips]', err);
    res.status(500).json({ trips: [], error: err.message });
  }
}

// ─── PRINT EXPENSES SUMMARY ──────────────────────────────────────────────────
export async function printExpenses(req, res) {
  try {
    const { id } = req.params;
    const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [id]);
    if (!trip) return res.status(404).send('Trip not found');

    const [tripOrders] = await pool.query(`
      SELECT o.id, o.job_no, o.direction, o.status,
             o.price_amount, o.cod_amount, o.declared_weight,
             s.name AS sender_name, r.name AS receiver_name
      FROM trip_orders to2
      JOIN orders o ON o.id = to2.order_id
      LEFT JOIN customers s ON s.id = o.sender_id
      LEFT JOIN customers r ON r.id = o.receiver_id
      WHERE to2.trip_id = ?
      ORDER BY o.created_at ASC
    `, [id]);

    const [tripExpenses] = await pool.query(`
      SELECT e.*, u.name as created_by_name 
      FROM expenses e
      LEFT JOIN users u ON e.created_by = u.id
      WHERE e.trip_id = ?
      ORDER BY e.expense_date ASC, e.id ASC
    `, [id]);

    const expensesSummary = tripExpenses.reduce((acc, exp) => {
      const cur = exp.currency || 'THB';
      const amt = Number(exp.amount) || 0;
      acc[cur] = (acc[cur] || 0) + amt;
      return acc;
    }, { THB: 0, LAK: 0, USD: 0 });

    const [settingRows] = await pool.query('SELECT setting_key, setting_value FROM company_settings');
    const company = Object.fromEntries(settingRows.map(r => [r.setting_key, r.setting_value]));

    // Get latest exchange rates
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

    res.render('trips/expense-print', {
      layout: false,
      trip,
      tripOrders,
      tripExpenses,
      expensesSummary,
      rates,
      company,
      user: req.session.user
    });
  } catch (error) {
    console.error('Print expenses error:', error);
    res.status(500).send('Error generating print view: ' + error.message);
  }
}

// ─── SETTLE TRIP EXPENSES ────────────────────────────────────────────────────
export async function settleTrip(req, res) {
  const { id } = req.params;
  const { settled_by } = req.body;

  try {
    const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [id]);
    if (!trip) {
      req.session.flash = { type: 'error', message: 'ไม่พบรอบรถ' };
      return res.redirect('/trips');
    }

    if (!settled_by || settled_by.trim() === '') {
      // Undo settlement: set settled_by = NULL, settled_at = NULL
      await pool.query(
        'UPDATE trips SET settled_by = NULL, settled_at = NULL WHERE id = ?',
        [id]
      );
      // Revert paid_by of expenses from the old settled person back to 'คนขับรถ (สำรองจ่าย)'
      if (trip.settled_by) {
        await pool.query(
          "UPDATE expenses SET paid_by = 'คนขับรถ (สำรองจ่าย)' WHERE trip_id = ? AND paid_by = ?",
          [id, trip.settled_by]
        );
      }
      req.session.flash = { type: 'success', message: 'ยกเลิกการตัดยอดเคลียร์จ่ายคืนเรียบร้อย' };
    } else {
      // Settle: set settled_by = settled_by, settled_at = NOW()
      const settledPerson = settled_by.trim();
      await pool.query(
        'UPDATE trips SET settled_by = ?, settled_at = NOW() WHERE id = ?',
        [settledPerson, id]
      );
      // Update only driver-advanced or blank expenses of this trip to be paid by the settledPerson
      await pool.query(
        "UPDATE expenses SET paid_by = ? WHERE trip_id = ? AND (paid_by = 'คนขับรถ (สำรองจ่าย)' OR paid_by IS NULL OR paid_by = '')",
        [settledPerson, id]
      );
      req.session.flash = { type: 'success', message: `ตัดยอดเคลียร์จ่ายคืนสำเร็จโดย ${settledPerson}` };
    }

    res.redirect(`/trips/${id}`);
  } catch (error) {
    console.error('[Trip settleTrip] error:', error);
    req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาดในการตัดยอด: ' + error.message };
    res.redirect(`/trips/${id}`);
  }
}

// ─── CANCEL TRIP (Admin Only) ─────────────────────────────────────────────────
/**
 * ยกเลิกรอบรถ — เฉพาะ admin สูงสุดเท่านั้น
 * - ตั้ง trip.status = 'CANCELLED'
 * - Revert orders กลับ status ก่อนขึ้นรถ (RECEIVED_WH_TH หรือ RECEIVED_WH_LA ตาม direction)
 * - บันทึก status log ทุก order
 */
export async function cancelTrip(req, res) {
  const { id } = req.params;
  const { cancel_reason = '' } = req.body;

  try {
    const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [id]);
    if (!trip) {
      req.session.flash = { type: 'error', message: 'ไม่พบรอบรถ' };
      return res.redirect('/trips');
    }

    if (trip.status === 'CANCELLED') {
      req.session.flash = {
        type: 'error',
        message: 'รอบรถนี้ถูกยกเลิกไปแล้ว',
      };
      return res.redirect(`/trips/${id}`);
    }

    // Determine revert status based on trip direction
    const revertStatus = trip.direction === 'LA_TO_TH' ? 'RECEIVED_WH_LA' : 'RECEIVED_WH_TH';
    const note = `ยกเลิกรอบรถ ${trip.trip_no}${cancel_reason ? ': ' + cancel_reason : ''}`;

    // Get all orders in this trip
    const [tripOrders] = await pool.query(
      'SELECT o.id, o.status FROM trip_orders to2 JOIN orders o ON o.id = to2.order_id WHERE to2.trip_id = ?',
      [id]
    );

    // Cancel the trip
    await pool.query("UPDATE trips SET status = 'CANCELLED' WHERE id = ?", [id]);

    // Revert orders back to warehouse received status & detach from trip
    if (tripOrders.length > 0) {
      const orderIds = tripOrders.map(o => o.id);
      const ph = orderIds.map(() => '?').join(',');

      await pool.query(
        `UPDATE orders SET status = ?, trip_id = NULL WHERE id IN (${ph})`,
        [revertStatus, ...orderIds]
      );

      // Log each order status change
      for (const order of tripOrders) {
        await logStatus(
          order.id,
          order.status,
          revertStatus,
          note,
          req.session.user?.id
        );
      }
    }

    console.log(
      `[Trip cancelTrip] Trip ${trip.trip_no} (id=${id}) CANCELLED by admin=${req.session.user?.username}` +
      ` | ${tripOrders.length} orders reverted to ${revertStatus}`
    );

    req.session.flash = {
      type: 'success',
      message: `ยกเลิกรอบรถ ${trip.trip_no} สำเร็จ — ออเดอร์ ${tripOrders.length} รายการ คืนสู่คลังแล้ว`,
    };
    res.redirect(`/trips/${id}`);
  } catch (err) {
    console.error('[Trip cancelTrip]', err);
    req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาด: ' + err.message };
    res.redirect(`/trips/${id}`);
  }
}
