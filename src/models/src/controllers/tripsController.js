import pool from '../config/db.js';

export async function list(req, res) {
  const [trips] = await pool.query(
    "SELECT id, trip_no, trip_date, origin_border, dest_border, status FROM trips ORDER BY trip_date DESC LIMIT 100"
  );
  res.render('trips/list', { trips, user: req.session.user, title: 'รอบรถ' });
}

export async function showCreate(req, res) {
  const [availableOrders] = await pool.query(
    "SELECT id, job_no, direction, status FROM orders WHERE id NOT IN (SELECT order_id FROM trip_orders)"
  );
  res.render('trips/new', { user: req.session.user, error: null, title: 'สร้างรอบรถ', availableOrders });
}

export async function create(req, res) {
  const { trip_no, trip_date, origin_border, dest_border, vehicle, driver_name, order_ids = [] } = req.body;
  try {
    const [result] = await pool.query(
      `INSERT INTO trips (trip_no, trip_date, origin_border, dest_border, vehicle, driver_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [trip_no, trip_date, origin_border, dest_border, vehicle, driver_name]
    );
    const tripId = result.insertId;

    const ordersArray = Array.isArray(order_ids) ? order_ids : [order_ids].filter(Boolean);
    if (ordersArray.length) {
      const numericIds = ordersArray.map(Number).filter((n) => !Number.isNaN(n));
      if (numericIds.length) {
        const placeholders = numericIds.map(() => '?').join(',');
        const [currentStatuses] = await pool.query(
          `SELECT id, status FROM orders WHERE id IN (${placeholders})`,
          numericIds
        );
        const statusById = Object.fromEntries(currentStatuses.map((o) => [o.id, o.status || '-']));
        const values = numericIds.map(() => '(?, ?)').join(',');
        await pool.query(
          `INSERT IGNORE INTO trip_orders (trip_id, order_id) VALUES ${values}`,
          numericIds.flatMap((oid) => [tripId, oid])
        );
        await pool.query(
          `UPDATE orders SET trip_id = ?, status = 'ON_TRUCK_BORDER' WHERE id IN (${placeholders})`,
          [tripId, ...numericIds]
        );
        const statusLogValues = numericIds.map(() => '(?, ?, ?, ?, ?)').join(',');
        const logParams = numericIds.flatMap((oid) => [
          oid,
          statusById[oid] || null,
          'ON_TRUCK_BORDER',
          `ผูกเข้ารอบรถ ${trip_no}`,
          req.session.user?.id || null
        ]);
        await pool.query(
          `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
           VALUES ${statusLogValues}`,
          logParams
        );
      }
    }
    res.redirect(`/trips/${tripId}`);
  } catch (err) {
    const [availableOrders] = await pool.query(
      "SELECT id, job_no, direction, status FROM orders WHERE id NOT IN (SELECT order_id FROM trip_orders)"
    );
    res.render('trips/new', { user: req.session.user, error: err.message, title: 'สร้างรอบรถ', availableOrders });
  }
}

export async function detail(req, res) {
  const { id } = req.params;
  const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [id]);
  if (!trip) return res.status(404).send('ไม่พบรอบรถ');

  const [tripOrders] = await pool.query(
    `SELECT o.id, o.job_no, o.direction, o.status, o.price_amount, o.cod_amount
     FROM trip_orders to2
     JOIN orders o ON o.id = to2.order_id
     WHERE to2.trip_id = ?
     ORDER BY o.created_at DESC`,
    [id]
  );

  const [availableOrders] = await pool.query(
    "SELECT id, job_no, direction, status FROM orders WHERE id NOT IN (SELECT order_id FROM trip_orders)"
  );

  res.render('trips/detail', {
    user: req.session.user,
    title: `รอบรถ ${trip.trip_no}`,
    trip,
    tripOrders,
    availableOrders,
    error: null
  });
}

export async function attachOrders(req, res) {
  const { id } = req.params;
  const { order_ids = [] } = req.body;
  const ordersArray = Array.isArray(order_ids) ? order_ids : [order_ids].filter(Boolean);
  if (!ordersArray.length) return res.redirect(`/trips/${id}`);

  const numericIds = ordersArray.map(Number).filter((n) => !Number.isNaN(n));
  if (!numericIds.length) return res.redirect(`/trips/${id}`);

  try {
    const placeholders = numericIds.map(() => '?').join(',');
    const [currentStatuses] = await pool.query(
      `SELECT id, status FROM orders WHERE id IN (${placeholders})`,
      numericIds
    );
    const statusById = Object.fromEntries(currentStatuses.map((o) => [o.id, o.status || '-']));
    const values = numericIds.map(() => '(?, ?)').join(',');
    await pool.query(
      `INSERT IGNORE INTO trip_orders (trip_id, order_id) VALUES ${values}`,
      numericIds.flatMap((oid) => [id, oid])
    );
    await pool.query(
      `UPDATE orders SET trip_id = ?, status = 'ON_TRUCK_BORDER' WHERE id IN (${placeholders})`,
      [id, ...numericIds]
    );
    const statusLogValues = numericIds.map(() => '(?, ?, ?, ?, ?)').join(',');
    const logParams = numericIds.flatMap((oid) => [
      oid,
      statusById[oid] || null,
      'ON_TRUCK_BORDER',
      `ผูกเข้ารอบรถ ${id}`,
      req.session.user?.id || null
    ]);
    await pool.query(
      `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
       VALUES ${statusLogValues}`,
      logParams
    );
    res.redirect(`/trips/${id}`);
  } catch (err) {
    const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [id]);
    const [tripOrders] = await pool.query(
      `SELECT o.id, o.job_no, o.direction, o.status, o.price_amount, o.cod_amount
       FROM trip_orders to2
       JOIN orders o ON o.id = to2.order_id
       WHERE to2.trip_id = ?
       ORDER BY o.created_at DESC`,
      [id]
    );
    const [availableOrders] = await pool.query(
      "SELECT id, job_no, direction, status FROM orders WHERE id NOT IN (SELECT order_id FROM trip_orders)"
    );
    res.render('trips/detail', {
      user: req.session.user,
      title: `รอบรถ ${trip.trip_no}`,
      trip,
      tripOrders,
      availableOrders,
      error: err.message
    });
  }
}

export async function updateStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body; // Expect 'DEPARTED' or 'ARRIVED_DEST'

  try {
    const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [id]);
    if (!trip) return res.status(404).send('Trip not found');

    if (status === 'ON_ROUTE') {
      await pool.query('UPDATE trips SET status = ? WHERE id = ?', ['ON_ROUTE', id]);
      // Orders remain ON_TRUCK_BORDER
    } else if (status === 'ARRIVED') {
      // Update Trip
      await pool.query('UPDATE trips SET status = ? WHERE id = ?', ['ARRIVED', id]);

      // Update all assigned orders to 'ARRIVED_BORDER_WH' (Arrived at Destination Border Warehouse)
      // Get orders in this trip
      const [tripOrders] = await pool.query('SELECT order_id FROM trip_orders WHERE trip_id = ?', [id]);
      const orderIds = tripOrders.map(t => t.order_id);

      if (orderIds.length > 0) {
        const placeholders = orderIds.map(() => '?').join(',');

        // Update Status
        await pool.query(
          `UPDATE orders SET status = 'ARRIVED_BORDER_WH' WHERE id IN (${placeholders})`,
          orderIds
        );

        // Log Status Change
        for (const oid of orderIds) {
          await pool.query(
            `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
                      VALUES (?, ?, ?, ?, ?)`,
            [oid, 'ON_TRUCK_BORDER', 'ARRIVED_BORDER_WH', `Trip ${trip.trip_no} Arrived`, req.session.user.id]
          );
        }
      }
    }

    res.redirect(`/trips/${id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/trips/${id}`);
  }
}

export async function printManifest(req, res) {
  const { id } = req.params;
  const [[trip]] = await pool.query('SELECT * FROM trips WHERE id = ?', [id]);
  if (!trip) return res.status(404).send('Not found');

  const [tripOrders] = await pool.query(
    `SELECT o.*, 
            s.name as sender_name, r.name as receiver_name 
            , s.phone as sender_phone, r.phone as receiver_phone
     FROM trip_orders to2
     JOIN orders o ON o.id = to2.order_id
     LEFT JOIN customers s ON s.id = o.sender_id
     LEFT JOIN customers r ON r.id = o.receiver_id
     WHERE to2.trip_id = ?
     ORDER BY o.created_at ASC`,
    [id]
  );

  res.render('trips/manifest', {
    layout: false, // No layout for print view
    trip,
    tripOrders,
    user: req.session.user
  });
}
