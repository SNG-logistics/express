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
import { transitionOrder, withTransaction, WorkflowError } from '../services/orderWorkflowService.js';
import { kickNotificationWorker } from '../services/notificationService.js';

// ─── Allowed trip status transitions ─────────────────────────────────────────
const TRIP_TRANSITIONS = {
  'PLANNED':   ['LOADING', 'CANCELLED'],
  'LOADING':   ['DEPARTED', 'PLANNED', 'CANCELLED'],
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
    AND o.status IN ('RECEIVED_WH_TH','RECEIVED_WH_LA')
    AND o.screening_status <> 'REJECTED'
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
    const ordersArray = (Array.isArray(order_ids) ? order_ids : [order_ids]).filter(Boolean);
    const numericIds = [...new Set(ordersArray.map(Number).filter(Number.isInteger))];
    let tripId;

    await withTransaction(async (conn) => {
      const [[existing]] = await conn.query('SELECT id FROM trips WHERE trip_no=? FOR UPDATE', [trip_no]);
      if (existing) throw new WorkflowError(`Trip No "${trip_no}" is already used`, 409);

      const [result] = await conn.query(
        `INSERT INTO trips (trip_no, trip_date, direction, origin_border, dest_border, border_checkpoint, vehicle, driver_name, notes, max_weight, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED')`,
        [trip_no, trip_date, direction, origin_border || null, dest_border || null, border_checkpoint,
          vehicle || null, driver_name || null, notes || null, max_weight ? Number(max_weight) : null]
      );
      tripId = result.insertId;

      if (numericIds.length) {
        const placeholders = numericIds.map(() => '?').join(',');
        const [orders] = await conn.query(
          `SELECT id, direction, status, screening_status,
                  COALESCE(actual_weight,declared_weight,weight_kg,0) AS load_weight
           FROM orders WHERE id IN (${placeholders}) FOR UPDATE`,
          numericIds
        );
        if (orders.length !== numericIds.length) throw new WorkflowError('One or more orders do not exist', 404);
        const expectedStatus = direction === 'LA_TO_TH' ? 'RECEIVED_WH_LA' : 'RECEIVED_WH_TH';
        for (const order of orders) {
          if (order.direction !== direction || order.status !== expectedStatus) {
            throw new WorkflowError(`Order ${order.id} is not eligible for this trip`, 409);
          }
          if (order.screening_status === 'REJECTED') {
            throw new WorkflowError(`Order ${order.id} was rejected in screening`, 409);
          }
        }
        const totalWeight = orders.reduce((sum, order) => sum + Number(order.load_weight || 0), 0);
        if (max_weight && totalWeight > Number(max_weight)) {
          throw new WorkflowError(`Trip capacity exceeded (${totalWeight} > ${Number(max_weight)} kg)`, 409);
        }
        const vals = numericIds.map(() => '(?,?)').join(',');
        await conn.query(
          `INSERT INTO trip_orders (trip_id, order_id) VALUES ${vals}`,
          numericIds.flatMap(orderId => [tripId, orderId])
        );
        await conn.query(
          `UPDATE orders SET trip_id=? WHERE id IN (${placeholders})`,
          [tripId, ...numericIds]
        );
      }
    });

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
      AND o.status IN ('RECEIVED_WH_TH','RECEIVED_WH_LA')
      AND o.screening_status <> 'REJECTED'
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
    AND o.status IN ('RECEIVED_WH_TH','RECEIVED_WH_LA')
    AND o.screening_status <> 'REJECTED'
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
    await withTransaction(async (conn) => {
      const placeholders = numericIds.map(() => '?').join(',');
      const [orders] = await conn.query(
        `SELECT id, direction, status, screening_status,
                COALESCE(actual_weight,declared_weight,weight_kg,0) load_weight
         FROM orders WHERE id IN (${placeholders}) FOR UPDATE`,
        numericIds
      );
      if (orders.length !== numericIds.length) throw new WorkflowError('One or more orders do not exist', 404);
      const expectedStatus = trip.direction === 'LA_TO_TH' ? 'RECEIVED_WH_LA' : 'RECEIVED_WH_TH';
      for (const order of orders) {
        if (order.direction !== trip.direction || order.status !== expectedStatus || order.screening_status === 'REJECTED') {
          throw new WorkflowError(`Order ${order.id} is not eligible for this trip`, 409);
        }
      }
      const [[current]] = await conn.query(
        `SELECT COALESCE(SUM(COALESCE(o.actual_weight,o.declared_weight,o.weight_kg,0)),0) total
         FROM trip_orders t JOIN orders o ON o.id=t.order_id WHERE t.trip_id=?`,
        [id]
      );
      const added = orders.reduce((sum, order) => sum + Number(order.load_weight || 0), 0);
      if (trip.max_weight && Number(current.total) + added > Number(trip.max_weight)) {
        throw new WorkflowError('Trip capacity would be exceeded', 409);
      }
      const vals = numericIds.map(() => '(?,?)').join(',');
      await conn.query(
        `INSERT INTO trip_orders (trip_id, order_id) VALUES ${vals}`,
        numericIds.flatMap(orderId => [id, orderId])
      );
      await conn.query(
        `UPDATE orders SET trip_id=? WHERE id IN (${placeholders})`,
        [id, ...numericIds]
      );
    });

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

  const revertStatus = trip.direction === 'LA_TO_TH' ? 'RECEIVED_WH_LA' : 'RECEIVED_WH_TH';
  await withTransaction(async (conn) => {
    await conn.query('DELETE FROM trip_orders WHERE trip_id=? AND order_id=?', [id, orderId]);
    if (order.status === 'ON_TRUCK') {
      await transitionOrder({ orderId, toStatus: revertStatus, userId: req.session.user?.id,
        note: `Detached from trip ${trip.trip_no}`, source: 'TRIP_DETACH',
        updates: { trip_id: null }, connection: conn, force: true, notify: false });
    } else {
      await conn.query('UPDATE orders SET trip_id=NULL WHERE id=?', [orderId]);
    }
  });

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

    let notificationOrderIds = [];
    await withTransaction(async (conn) => {
      const [[lockedTrip]] = await conn.query('SELECT * FROM trips WHERE id=? FOR UPDATE', [id]);
      const lockedAllowed = TRIP_TRANSITIONS[lockedTrip.status] || [];
      if (!lockedAllowed.includes(status)) throw new WorkflowError('Trip status changed; reload and retry', 409);
      const [tripOrders] = await conn.query(
        `SELECT o.id, o.status FROM trip_orders t JOIN orders o ON o.id=t.order_id
         WHERE t.trip_id=? FOR UPDATE`,
        [id]
      );
      if (status === 'DEPARTED') {
        if (!tripOrders.length) throw new WorkflowError('Cannot depart with an empty trip', 409);
        // Driver-friendly departure: instead of blocking when parcels were not
        // handoff-scanned, auto-load any warehouse-received orders onto the truck
        // so the trip can leave from the button. Orders in other states are left
        // untouched and never block departure.
        for (const order of tripOrders) {
          if (order.status === 'ON_TRUCK') continue;
          if (['RECEIVED_WH_TH', 'RECEIVED_WH_LA'].includes(order.status)) {
            await transitionOrder({
              orderId: order.id,
              toStatus: 'ON_TRUCK',
              userId: req.session.user?.id,
              note: `Auto-loaded on depart ${lockedTrip.trip_no}`,
              source: 'TRIP_DEPART_AUTOLOAD',
              connection: conn,
            });
          }
        }
      }
      await conn.query('UPDATE trips SET status=? WHERE id=?', [status, id]);

      const toOrderStatus = TRIP_TO_ORDER_STATUS[status];
      if (toOrderStatus) {
        for (const order of tripOrders) {
          await transitionOrder({
            orderId: order.id,
            toStatus: toOrderStatus,
            userId: req.session.user?.id,
            note: `Trip ${lockedTrip.trip_no} -> ${status}${note ? ': ' + note : ''}`,
            source: 'TRIP_STATUS',
            connection: conn,
          });
          notificationOrderIds.push(order.id);
        }
      }
    });
    for (const orderId of notificationOrderIds) kickNotificationWorker(orderId);

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
    const result = await withTransaction(async conn => {
      const [[trip]] = await conn.query('SELECT * FROM trips WHERE id=? FOR UPDATE', [id]);
      if (!trip) throw new WorkflowError('ไม่พบรอบรถ', 404, 'TRIP_NOT_FOUND');
      if (!(TRIP_TRANSITIONS[trip.status] || []).includes('CANCELLED')) {
        throw new WorkflowError('ยกเลิกได้เฉพาะรอบที่ยังไม่ออกรถ', 409, 'TRIP_CANNOT_CANCEL');
      }

      const revertStatus = trip.direction === 'LA_TO_TH' ? 'RECEIVED_WH_LA' : 'RECEIVED_WH_TH';
      const note = `ยกเลิกรอบรถ ${trip.trip_no}${cancel_reason ? ': ' + cancel_reason : ''}`;
      const [tripOrders] = await conn.query(
        `SELECT o.id, o.status FROM trip_orders to2
         JOIN orders o ON o.id=to2.order_id
         WHERE to2.trip_id=? FOR UPDATE`,
        [id]
      );
      const invalid = tripOrders.find(order => ![revertStatus, 'ON_TRUCK'].includes(order.status));
      if (invalid) {
        throw new WorkflowError(
          `Order ${invalid.id} already advanced to ${invalid.status}; trip cannot be cancelled`,
          409,
          'ORDER_ALREADY_IN_TRANSIT'
        );
      }

      const [tripUpdate] = await conn.query(
        "UPDATE trips SET status='CANCELLED' WHERE id=? AND status=?",
        [id, trip.status]
      );
      if (tripUpdate.affectedRows !== 1) throw new WorkflowError('Trip changed; reload and try again', 409);

      const notifyOrderIds = [];
      for (const order of tripOrders) {
        if (order.status === 'ON_TRUCK') {
          await transitionOrder({
            orderId: order.id,
            toStatus: revertStatus,
            userId: req.session.user?.id,
            note,
            source: 'TRIP_CANCEL',
            updates: { trip_id: null },
            connection: conn,
            force: true,
          });
          notifyOrderIds.push(order.id);
        } else {
          await conn.query('UPDATE orders SET trip_id=NULL WHERE id=?', [order.id]);
          await conn.query(
            `INSERT INTO order_status_logs
               (order_id, from_status, to_status, note, action_by, action_at)
             VALUES (?,?,?,?,?,NOW())`,
            [order.id, order.status, order.status, `${note} [detached]`, req.session.user?.id || null]
          );
        }
      }
      return { trip, tripOrders, notifyOrderIds };
    });
    for (const orderId of result.notifyOrderIds) kickNotificationWorker(orderId);

    console.log(
      `[Trip cancelTrip] Trip ${result.trip.trip_no} (id=${id}) CANCELLED by admin=${req.session.user?.username}` +
      ` | ${result.tripOrders.length} orders detached`
    );

    req.session.flash = {
      type: 'success',
      message: `ยกเลิกรอบรถ ${result.trip.trip_no} สำเร็จ — ถอดออเดอร์ ${result.tripOrders.length} รายการแล้ว`,
    };
    res.redirect(`/trips/${id}`);
  } catch (err) {
    console.error('[Trip cancelTrip]', err);
    req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาด: ' + err.message };
    res.redirect(`/trips/${id}`);
  }
}
