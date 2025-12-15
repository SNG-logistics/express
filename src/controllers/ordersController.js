import pool from '../config/db.js';
import { sendOrderUpdate } from '../services/whatsappService.js';

const allowedDirections = ['TH_TO_LA', 'LA_TO_TH'];

async function logStatus(orderId, fromStatus, toStatus, note, userId) {
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, ?, ?)`,
    [orderId, fromStatus, toStatus, note, userId || null]
  );
}

export async function list(req, res) {
  try {
    const { q, status, direction } = req.query;
    let sql = `
      SELECT o.id, o.job_no, o.direction, o.status, o.price_amount, o.cod_amount, o.created_at,
             s.name as sender_name, r.name as receiver_name
      FROM orders o
      LEFT JOIN customers s ON o.sender_id = s.id
      LEFT JOIN customers r ON o.receiver_id = r.id
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      sql += ` AND (
        o.job_no LIKE ? OR 
        s.name LIKE ? OR 
        r.name LIKE ? OR 
        s.phone LIKE ? OR
        r.phone LIKE ?
      )`;
      const term = `%${q}%`;
      params.push(term, term, term, term, term);
    }

    if (status) {
      sql += ` AND o.status = ?`;
      params.push(status);
    }

    if (direction) {
      sql += ` AND o.direction = ?`;
      params.push(direction);
    }

    sql += ` ORDER BY o.created_at DESC LIMIT 100`;

    const [orders] = await pool.query(sql, params);

    res.render('orders/list', {
      orders,
      user: req.session.user,
      title: 'รายการออเดอร์',
      query: req.query // Pass back to view to repopulate inputs
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading orders');
  }
}

export async function showCreate(req, res) {
  const [customers] = await pool.query("SELECT id, name, type FROM customers WHERE active = 1 ORDER BY name ASC");
  const [shippingRates] = await pool.query("SELECT * FROM shipping_rates WHERE active = 1 ORDER BY price ASC");

  res.render('orders/new', {
    user: req.session.user,
    customers,
    shippingRates,
    error: null,
    title: 'สร้างออเดอร์ใหม่'
  });
}

export async function create(req, res) {
  const {
    job_no, direction, sender_id, receiver_id,
    price_amount, cod_amount, requires_customs,
    service_type, declared_weight, declared_size, declared_value
  } = req.body;

  const payload = {
    job_no: (job_no || '').trim(),
    direction,
    sender_id: sender_id ? Number(sender_id) : null,
    receiver_id: receiver_id ? Number(receiver_id) : null,
    price_amount: price_amount ? Number(price_amount) : 0,
    cod_amount: cod_amount ? Number(cod_amount) : 0,
    requires_customs: requires_customs ? 1 : 0,
    service_type,
    declared_weight: declared_weight ? Number(declared_weight) : null,
    declared_size,
    declared_value: declared_value ? Number(declared_value) : null
    image_path: req.file ? `/uploads/orders/${req.file.filename}` : null
  };

  if (!payload.job_no) {
    // Generate simple auto job no if empty: SNG-TIMESTAMP (for now, or standard implementation)
    payload.job_no = `SNG-${Date.now().toString().slice(-8)}`;
  }

  if (!allowedDirections.includes(payload.direction)) {
    req.session.flash = { type: 'error', message: 'Invalid direction' };
    return res.redirect('/orders/new');
  }
  if (Number.isNaN(payload.price_amount) || payload.price_amount < 0) {
    req.session.flash = { type: 'error', message: 'Price must be >= 0' };
    return res.redirect('/orders/new');
  }

  try {
    await pool.query(
      `INSERT INTO orders (
        job_no, direction, sender_id, receiver_id, 
        price_amount, cod_amount, requires_customs,
        service_type, declared_weight, declared_size, declared_value,
        image_path
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.job_no,
        payload.direction,
        payload.sender_id,
        payload.receiver_id,
        payload.price_amount,
        payload.cod_amount,
        payload.requires_customs,
        payload.service_type,
        payload.declared_weight,
        payload.declared_size,
        payload.declared_value,
        payload.image_path
      ]
    );
    res.redirect('/orders');
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
    res.redirect('/orders/new');
  }
}

export async function detail(req, res) {
  const { id } = req.params;
  const [[order]] = await pool.query(
    `SELECT o.*, 
            s.name as sender_name, s.address as sender_address, s.phone as sender_phone,
            r.name as receiver_name, r.address as receiver_address, r.phone as receiver_phone
     FROM orders o
     LEFT JOIN customers s ON s.id = o.sender_id
     LEFT JOIN customers r ON r.id = o.receiver_id
     WHERE o.id = ?`,
    [id]
  );
  if (!order) {
    req.session.flash = { type: 'error', message: 'Order not found' };
    return res.redirect('/orders');
  }
  const [logs] = await pool.query(
    'SELECT osl.*, u.username FROM order_status_logs osl LEFT JOIN users u ON u.id = osl.action_by WHERE order_id = ? ORDER BY action_at DESC',
    [id]
  );

  // Fetch expenses/payments
  const [payments] = await pool.query(
    'SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC',
    [id]
  );

  res.render('orders/detail', {
    order,
    logs,
    payments,
    user: req.session.user,
    title: `Order ${order.job_no}`,
    error: null
  });
}

export async function receiveOrder(req, res) {
  const { id } = req.params;
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  // ... (re-fetching logic similar to detail if error occurs)
  // For brevity in this tool call, I'm focusing on the main 'detail' view logic. 
  // However, I must update the catch block rendering too.

  if (!order) {
    req.session.flash = { type: 'error', message: 'Order not found' };
    return res.redirect('/orders');
  }

  const toStatus =
    order.direction === 'TH_TO_LA'
      ? 'RECEIVED_WH_TH'
      : order.direction === 'LA_TO_TH'
        ? 'RECEIVED_WH_LA'
        : null;

  if (!toStatus) {
    req.session.flash = { type: 'error', message: 'Invalid direction' };
    return res.redirect('/orders');
  }

  // Role Validation
  const user = req.session.user;
  const isThaiWH = user && user.role === 'thai_warehouse';
  const isLaoWH = user && user.role === 'lao_warehouse';
  const isAdmin = user && ['admin', 'manager'].includes(user.role);

  if (isThaiWH && toStatus !== 'RECEIVED_WH_TH') {
    req.session.flash = { type: 'error', message: 'Thai Warehouse can only receive TH->LA orders' };
    return res.redirect(`/orders/${id}`);
  }

  if (isLaoWH && toStatus !== 'RECEIVED_WH_LA') {
    req.session.flash = { type: 'error', message: 'Lao Warehouse can only receive LA->TH orders' };
    return res.redirect(`/orders/${id}`);
  }

  if (!isThaiWH && !isLaoWH && !isAdmin) {
    // If staff or others try to access this
    // Optional: restrict 'staff' if they shouldn't receive at all, but for now assuming strict role usage
  }

  try {
    await pool.query('UPDATE orders SET status = ? WHERE id = ?', [toStatus, id]);
    await logStatus(id, order.status, toStatus, 'Received into warehouse', req.session.user?.id);

    // Notify WhatsApp
    sendOrderUpdate(id, toStatus);

    req.session.flash = { type: 'success', message: 'Order received into warehouse' };
    res.redirect(`/orders/${id}`);
  } catch (err) {
    const [logs] = await pool.query(
      'SELECT osl.*, u.username FROM order_status_logs osl LEFT JOIN users u ON u.id = osl.action_by WHERE order_id = ? ORDER BY action_at DESC',
      [id]
    );
    const [payments] = await pool.query('SELECT * FROM payments WHERE order_id = ?', [id]);
    res.render('orders/detail', {
      order,
      logs,
      payments,
      user: req.session.user,
      title: `Order ${order.job_no}`,
      error: err.message
    });
  }
}

export async function startCrossing(req, res) {
  const { id } = req.params;
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'Order not found' };
    return res.redirect('/orders');
  }
  if (order.status !== 'ON_TRUCK_BORDER') {
    req.session.flash = { type: 'error', message: 'Not ready for CROSSING_BORDER' };
    return res.redirect(`/orders/${id}`);
  }

  try {
    await pool.query('UPDATE orders SET status = ? WHERE id = ?', ['CROSSING_BORDER', id]);
    await logStatus(id, order.status, 'CROSSING_BORDER', 'Departed to border', req.session.user?.id);
    req.session.flash = { type: 'success', message: 'Order set to CROSSING_BORDER' };
    res.redirect(`/orders/${id}`);
  } catch (err) {
    const [logs] = await pool.query(
      'SELECT osl.*, u.username FROM order_status_logs osl LEFT JOIN users u ON u.id = osl.action_by WHERE order_id = ? ORDER BY action_at DESC',
      [id]
    );
    res.render('orders/detail', {
      order,
      logs,
      user: req.session.user,
      title: `Order ${order.job_no}`,
      error: err.message
    });
  }
}

export async function arriveBorder(req, res) {
  const { id } = req.params;
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'Order not found' };
    return res.redirect('/orders');
  }
  if (order.status !== 'CROSSING_BORDER') {
    req.session.flash = { type: 'error', message: 'Not ready for ARRIVED_BORDER_WH' };
    return res.redirect(`/orders/${id}`);
  }

  try {
    await pool.query('UPDATE orders SET status = ? WHERE id = ?', ['ARRIVED_BORDER_WH', id]);
    await logStatus(id, order.status, 'ARRIVED_BORDER_WH', 'Arrived border warehouse', req.session.user?.id);
    req.session.flash = { type: 'success', message: 'Order arrived border warehouse' };
    res.redirect(`/orders/${id}`);
  } catch (err) {
    const [logs] = await pool.query(
      'SELECT osl.*, u.username FROM order_status_logs osl LEFT JOIN users u ON u.id = osl.action_by WHERE order_id = ? ORDER BY action_at DESC',
      [id]
    );
    res.render('orders/detail', {
      order,
      logs,
      user: req.session.user,
      title: `Order ${order.job_no}`,
      error: err.message
    });
  }
}

export async function arriveDestinationWh(req, res) {
  const { id } = req.params;
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'Order not found' };
    return res.redirect('/orders');
  }
  if (order.status !== 'ARRIVED_BORDER_WH') {
    req.session.flash = { type: 'error', message: 'Not ready for AT_DEST_WH' };
    return res.redirect(`/orders/${id}`);
  }

  try {
    await pool.query('UPDATE orders SET status = ? WHERE id = ?', ['AT_DEST_WH', id]);
    await logStatus(id, order.status, 'AT_DEST_WH', 'Received destination warehouse', req.session.user?.id);

    // Notify WhatsApp
    sendOrderUpdate(id, 'AT_DEST_WH');

    req.session.flash = { type: 'success', message: 'Order received at destination warehouse' };
    res.redirect(`/orders/${id}`);
  } catch (err) {
    const [logs] = await pool.query(
      'SELECT osl.*, u.username FROM order_status_logs osl LEFT JOIN users u ON u.id = osl.action_by WHERE order_id = ? ORDER BY action_at DESC',
      [id]
    );
    res.render('orders/detail', {
      order,
      logs,
      user: req.session.user,
      title: `Order ${order.job_no}`,
      error: err.message
    });
  }
}

export async function startDelivery(req, res) {
  const { id } = req.params;
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'Order not found' };
    return res.redirect('/orders');
  }
  if (order.status !== 'AT_DEST_WH') {
    req.session.flash = { type: 'error', message: 'Not ready for OUT_FOR_DELIVERY' };
    return res.redirect(`/orders/${id}`);
  }

  try {
    await pool.query('UPDATE orders SET status = ? WHERE id = ?', ['OUT_FOR_DELIVERY', id]);
    await logStatus(id, order.status, 'OUT_FOR_DELIVERY', 'Out for delivery', req.session.user?.id);

    // Notify WhatsApp
    sendOrderUpdate(id, 'OUT_FOR_DELIVERY');

    req.session.flash = { type: 'success', message: 'Order out for delivery' };
    res.redirect(`/orders/${id}`);
  } catch (err) {
    const [logs] = await pool.query(
      'SELECT osl.*, u.username FROM order_status_logs osl LEFT JOIN users u ON u.id = osl.action_by WHERE order_id = ? ORDER BY action_at DESC',
      [id]
    );
    res.render('orders/detail', {
      order,
      logs,
      user: req.session.user,
      title: `Order ${order.job_no}`,
      error: err.message
    });
  }
}

export async function markDelivered(req, res) {
  const { id } = req.params;
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'Order not found' };
    return res.redirect('/orders');
  }
  if (order.status !== 'OUT_FOR_DELIVERY') {
    req.session.flash = { type: 'error', message: 'Not ready for DELIVERED' };
    return res.redirect(`/orders/${id}`);
  }

  try {
    await pool.query('UPDATE orders SET status = ? WHERE id = ?', ['DELIVERED', id]);
    await logStatus(id, order.status, 'DELIVERED', 'Delivered', req.session.user?.id);

    // Notify WhatsApp
    sendOrderUpdate(id, 'DELIVERED');

    req.session.flash = { type: 'success', message: 'Order marked as delivered' };
    res.redirect(`/orders/${id}`);
  } catch (err) {
    const [logs] = await pool.query(
      'SELECT osl.*, u.username FROM order_status_logs osl LEFT JOIN users u ON u.id = osl.action_by WHERE order_id = ? ORDER BY action_at DESC',
      [id]
    );
    res.render('orders/detail', {
      order,
      logs,
      user: req.session.user,
      title: `Order ${order.job_no}`,
      error: err.message
    });
  }
}

export async function closeOrder(req, res) {
  const { id } = req.params;
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'Order not found' };
    return res.redirect('/orders');
  }
  if (order.status !== 'DELIVERED' && order.status !== 'COD_COLLECTED') {
    req.session.flash = { type: 'error', message: 'Not ready to close' };
    return res.redirect(`/orders/${id}`);
  }
  if (order.cod_amount > 0) {
    const [[settlement]] = await pool.query(
      'SELECT status FROM cod_settlements WHERE order_id = ? LIMIT 1',
      [id]
    );
    if (!settlement || settlement.status !== 'REMITTED') {
      req.session.flash = { type: 'error', message: 'COD not remitted; cannot close order' };
      return res.redirect(`/orders/${id}`);
    }
  }

  try {
    await pool.query('UPDATE orders SET status = ? WHERE id = ?', ['CLOSED', id]);
    await logStatus(id, order.status, 'CLOSED', 'Order closed', req.session.user?.id);
    req.session.flash = { type: 'success', message: 'Order closed' };
    res.redirect(`/orders/${id}`);
  } catch (err) {
    const [logs] = await pool.query(
      'SELECT osl.*, u.username FROM order_status_logs osl LEFT JOIN users u ON u.id = osl.action_by WHERE order_id = ? ORDER BY action_at DESC',
      [id]
    );
    res.render('orders/detail', {
      order,
      logs,
      user: req.session.user,
      title: `Order ${order.job_no}`,
      error: err.message
    });
  }
}

export async function printWaybill(req, res) {
  const { id } = req.params;
  // Get order with sender/receiver details
  const [[order]] = await pool.query(
    `SELECT o.*, 
            s.name as sender_name, s.address as sender_address, s.phone as sender_phone, s.province as sender_province,
            r.name as receiver_name, r.address as receiver_address, r.phone as receiver_phone, r.province as receiver_province
     FROM orders o
     LEFT JOIN customers s ON s.id = o.sender_id
     LEFT JOIN customers r ON r.id = o.receiver_id
     WHERE o.id = ?`,
    [id]
  );

  if (!order) return res.status(404).send('Not found');

  res.render('orders/waybill', {
    layout: false,
    order,
    user: req.session.user
  });
}

export async function showScan(req, res) {
  res.render('orders/scan', {
    user: req.session.user,
    title: 'โหมดสแกน (Scanner Mode)',
    lastScan: req.session.lastScan || null,
    flash: req.session.scanFlash || null
  });
  // Clear flush after show
  delete req.session.lastScan;
  delete req.session.scanFlash;
}

export async function processScan(req, res) {
  const { job_no, action_mode } = req.body;
  const safeJobNo = (job_no || '').trim();

  try {
    const [[order]] = await pool.query('SELECT * FROM orders WHERE job_no = ?', [safeJobNo]);

    if (!order) {
      req.session.scanFlash = { type: 'error', message: `ไม่พบออเดอร์: ${safeJobNo}` };
      req.session.lastScan = { job_no: safeJobNo, status: 'Not Found', time: new Date() };
      return res.redirect('/orders/scan');
    }

    let nextStatus = null;
    let logNote = '';

    // Determine target status based on Action Mode
    switch (action_mode) {
      case 'receive':
        if (order.direction === 'TH_TO_LA') nextStatus = 'RECEIVED_WH_TH';
        else if (order.direction === 'LA_TO_TH') nextStatus = 'RECEIVED_WH_LA';
        logNote = 'Received via Scanner';
        break;
      case 'crossing':
        nextStatus = 'CROSSING_BORDER';
        logNote = 'Crossing via Scanner';
        break;
      case 'arrived_border':
        nextStatus = 'ARRIVED_BORDER_WH';
        logNote = 'Arrived Border via Scanner';
        break;
      case 'at_dest':
        nextStatus = 'AT_DEST_WH';
        logNote = 'At Dest WH via Scanner';
        break;
      case 'delivery':
        nextStatus = 'OUT_FOR_DELIVERY';
        logNote = 'Out for Delivery via Scanner';
        break;
      case 'delivered':
        nextStatus = 'DELIVERED';
        logNote = 'Delivered via Scanner';
        break;
      default:
        // No action, just lookup
        break;
    }

    if (nextStatus) {
      await pool.query('UPDATE orders SET status = ? WHERE id = ?', [nextStatus, order.id]);
      await logStatus(order.id, order.status, nextStatus, logNote, req.session.user?.id);

      // Notify WhatsApp
      sendOrderUpdate(order.id, nextStatus);
      req.session.scanFlash = { type: 'success', message: `สำเร็จ! ${safeJobNo} -> ${nextStatus}` };
      req.session.lastScan = { job_no: safeJobNo, status: nextStatus, time: new Date() };
    } else {
      // Just showing info
      req.session.scanFlash = { type: 'info', message: `สถานะปัจจุบัน: ${order.status}` };
      req.session.lastScan = { job_no: safeJobNo, status: order.status, time: new Date() };
    }

    res.redirect('/orders/scan');
  } catch (err) {
    console.error(err);
    req.session.scanFlash = { type: 'error', message: err.message };
    res.redirect('/orders/scan');
  }
}

export async function showEdit(req, res) {
  const { id } = req.params;
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);

  if (!order) {
    req.session.flash = { type: 'error', message: 'Order not found' };
    return res.redirect('/orders');
  }

  if (order.status === 'CLOSED') {
    req.session.flash = { type: 'error', message: 'Cannot edit closed order' };
    return res.redirect(`/orders/${id}`);
  }

  const [customers] = await pool.query("SELECT id, name, type FROM customers WHERE active = 1 ORDER BY name ASC");

  res.render('orders/edit', {
    user: req.session.user,
    customers,
    order,
    error: null,
    title: `แก้ไขออเดอร์ ${order.job_no}`
  });
}

export async function update(req, res) {
  const { id } = req.params;
  const {
    direction, sender_id, receiver_id,
    price_amount, cod_amount, requires_customs,
    service_type, declared_weight, declared_size, declared_value
  } = req.body;

  try {
    const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
    if (!order) {
      req.session.flash = { type: 'error', message: 'Order not found' };
      return res.redirect('/orders');
    }

    const payload = {
      direction,
      sender_id: sender_id ? Number(sender_id) : null,
      receiver_id: receiver_id ? Number(receiver_id) : null,
      price_amount: price_amount ? Number(price_amount) : 0,
      cod_amount: cod_amount ? Number(cod_amount) : 0,
      requires_customs: requires_customs ? 1 : 0,
      service_type,
      declared_weight: declared_weight ? Number(declared_weight) : null,
      declared_size,
      declared_value: declared_value ? Number(declared_value) : null
    };

    if (!allowedDirections.includes(payload.direction)) {
      throw new Error('Invalid direction');
    }

    await pool.query(
      `UPDATE orders SET 
        direction=?, sender_id=?, receiver_id=?, 
        price_amount=?, cod_amount=?, requires_customs=?,
        service_type=?, declared_weight=?, declared_size=?, declared_value=?
       WHERE id=?`,
      [
        payload.direction,
        payload.sender_id,
        payload.receiver_id,
        payload.price_amount,
        payload.cod_amount,
        payload.requires_customs,
        payload.service_type,
        payload.declared_weight,
        payload.declared_size,
        payload.declared_value,
        id
      ]
    );

    await logStatus(id, order.status, order.status, 'Order details updated', req.session.user?.id);

    req.session.flash = { type: 'success', message: 'อัปเดตข้อมูลสำเร็จ' };
    res.redirect(`/orders/${id}`);

  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
    res.redirect(`/orders/${id}/edit`);
  }
}
