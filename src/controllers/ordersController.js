import pool from '../config/db.js';
import { ORDER_STATUS_LABELS } from '../constants/statuses.js';
import { canTransitionOrder } from '../constants/transitions.js';
import { transitionOrder, withTransaction } from '../services/orderWorkflowService.js';
import { parseDimensionSum, resolveShippingRate } from '../services/pricingService.js';
import { enqueueOrderNotification, kickNotificationWorker } from '../services/notificationService.js';
import { assignBranchToOrder, assignOrderToBranch } from './branchesController.js';


const allowedDirections = ['TH_TO_LA', 'LA_TO_TH'];

/**
 * Validate status transition — ถ้าไม่อนุญาต จะ set flash + redirect
 * @returns {boolean} true ถ้าอนุญาต, false ถ้า redirect แล้ว
 */
function validateTransition(req, res, order, toStatus) {
  if (!canTransitionOrder(order.status, toStatus)) {
    const currentLabel = ORDER_STATUS_LABELS[order.status]?.label || order.status;
    const targetLabel = ORDER_STATUS_LABELS[toStatus]?.label || toStatus;
    req.session.flash = {
      type: 'error',
      message: `ไม่สามารถเปลี่ยนสถานะจาก "${currentLabel}" → "${targetLabel}" ได้`
    };
    res.redirect(`/orders/${order.id}`);
    return false;
  }
  return true;
}

async function logStatus(orderId, fromStatus, toStatus, note, userId) {
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, ?, ?)`,
    [orderId, fromStatus, toStatus, note, userId || null]
  );
}

export async function list(req, res) {
  try {
    const { q, status, direction, page: pageStr } = req.query;
    const page     = Math.max(1, parseInt(pageStr) || 1);
    const pageSize = 50;
    const offset   = (page - 1) * pageSize;

    let countSql = `
      SELECT COUNT(*) AS total
      FROM orders o
      LEFT JOIN customers s ON o.sender_id = s.id
      LEFT JOIN customers r ON o.receiver_id = r.id
      WHERE 1=1
    `;
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
      const cond = ` AND (o.job_no LIKE ? OR s.name LIKE ? OR r.name LIKE ? OR s.phone LIKE ? OR r.phone LIKE ?)`;
      sql      += cond;
      countSql += cond;
      const term = `%${q}%`;
      params.push(term, term, term, term, term);
    }

    if (status) {
      sql      += ` AND o.status = ?`;
      countSql += ` AND o.status = ?`;
      params.push(status);
    }

    if (direction) {
      sql      += ` AND o.direction = ?`;
      countSql += ` AND o.direction = ?`;
      params.push(direction);
    }

    sql += ` ORDER BY o.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`;

    const [[{ total }]] = await pool.query(countSql, params);
    const [orders]      = await pool.query(sql, params);

    const pages = Math.ceil(total / pageSize) || 1;

    const role = req.session.user?.role || '';
    const can = {
      createOrder: ['admin','staff','manager','warehouse_th','thai_warehouse','customer_service'].includes(role),
      useScanner:  ['admin','staff','manager','warehouse_th','warehouse_la','thai_warehouse','lao_warehouse','dispatcher'].includes(role),

    };

    res.render('orders/list', {
      orders,
      user:  req.session.user,
      can,
      title: 'รายการออเดอร์',
      query: req.query,
      pagination: { page, pages, total, pageSize },
    });
  } catch (err) {
    console.error('[orders.list]', err);
    res.status(500).send('เกิดข้อผิดพลาด: ' + err.message);
  }
}


export async function showCreate(req, res) {
  const [customers] = await pool.query("SELECT id, name, type, phone, country, is_credit FROM customers WHERE active = 1 ORDER BY name ASC");
  const [shippingRates] = await pool.query("SELECT * FROM shipping_rates WHERE active = 1 ORDER BY price ASC");

  // Restore form draft if existed (after validation error redirect)
  const draft = req.session.formDraft || null;
  delete req.session.formDraft;

  // Handle Quotation Integration
  const { quote_id } = req.query;
  let quoteData = null;
  let quoteReceiverId = null;
  let quoteReceiverName = '';

  if (quote_id) {
    const [[q]] = await pool.query('SELECT * FROM partner_quotations WHERE id = ?', [quote_id]);
    if (q) {
      quoteData = q;
      if (q.customer_phone) {
        // Find existing customer by phone
        const cleanPhone = q.customer_phone.replace(/[\s\-()]/g, '');
        const [[exist]] = await pool.query('SELECT id FROM customers WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, " ", ""), "-", ""), "(", ""), ")", "") = ? LIMIT 1', [cleanPhone]);
        
        if (exist) {
          quoteReceiverId = exist.id;
          quoteReceiverName = exist.name || q.customer_name || '';
        } else {
          const [res] = await pool.query(
            'INSERT INTO customers (name, phone, type, country) VALUES (?, ?, "person", "la")',
            [q.customer_name || 'ไม่ระบุชื่อ', cleanPhone]
          );
          quoteReceiverId = res.insertId;
          quoteReceiverName = q.customer_name || 'ไม่ระบุชื่อ';
        }
      }
    }
  }

  const role = req.session.user?.role || '';
  const can = {
    createOrder: ['admin','staff','manager','warehouse_th','thai_warehouse','customer_service'].includes(role),

  };

  res.render('orders/new', {
    user: req.session.user,
    can,
    customers,
    shippingRates,
    draft,
    quoteData,
    quoteReceiverId,
    quoteReceiverName,
    error: null,
    title: 'สร้างออเดอร์ใหม่'
  });
}

export async function create(req, res) {
  // 1. Parse & sanitize
  const {
    job_no, direction, sender_id, receiver_id,
    cod_amount, requires_customs,
    service_type, declared_weight,
    dim_w, dim_h, dim_d,
    declared_value, item_description, notes,
    source_type, is_fragile, item_count,
    force_duplicate, payment_method, quotation_id
  } = req.body;

  const dimW    = dim_w === '' || dim_w == null ? 0 : Number(dim_w);
  const dimH    = dim_h === '' || dim_h == null ? 0 : Number(dim_h);
  const dimD    = dim_d === '' || dim_d == null ? 0 : Number(dim_d);
  const dimStr  = (dimW && dimH && dimD) ? `${dimW}x${dimH}x${dimD}` : null;
  const volWeight = (dimW && dimH && dimD) ? Number(((dimW * dimH * dimD) / 5000).toFixed(2)) : null;
  const actualWeight = declared_weight ? Number(declared_weight) : null;
  const chargeableKg = (actualWeight || volWeight)
    ? Math.max(actualWeight || 0, volWeight || 0)
    : null;

  const payload = {
    job_no:           (job_no || '').trim().toUpperCase(),
    direction:        (direction || '').toUpperCase(),
    sender_id:        sender_id   ? Number(sender_id)   : null,
    receiver_id:      receiver_id ? Number(receiver_id) : null,
    price_amount:     0,
    payment_method:   payment_method || 'ORIGIN',
    cod_amount:       cod_amount  ? Number(cod_amount)  : 0,
    requires_customs: requires_customs ? 1 : 0,
    service_type:     service_type || null,
    declared_weight:  actualWeight,
    declared_size:    dimStr,
    declared_value:   declared_value  ? Number(declared_value) : null,
    item_description: item_description ? item_description.trim().substring(0, 500) : null,
    notes:            notes            ? notes.trim().substring(0, 1000)            : null,
    image_path:       req.file ? `/uploads/orders/${req.file.filename}` : null,
    created_by:       req.session.user?.id || null,
    // Phase 1 additional fields
    source_type:      source_type || 'WALKIN',
    is_fragile:       is_fragile ? 1 : 0,
    item_count:       item_count ? Number(item_count) : 1,
    weight_kg:        actualWeight,
    dim_l_cm:         dimD || null,   // depth = length
    dim_w_cm:         dimW || null,
    dim_h_cm:         dimH || null,
    chargeable_kg:    chargeableKg,
    quotation_id:     quotation_id ? Number(quotation_id) : null,
  };

  // 2. Server-side validation
  const errors = {};
  if (!allowedDirections.includes(payload.direction))
    errors.direction = 'เลือกทิศทางขนส่ง';
  if (!payload.sender_id)
    errors.sender_id = 'เลือกผู้ส่ง';
  if (!payload.receiver_id)
    errors.receiver_id = 'เลือกผู้รับ';
  if (payload.sender_id && payload.receiver_id && payload.sender_id === payload.receiver_id)
    errors.receiver_id = 'ผู้รับต้องไม่ใช่ผู้ส่ง';
  if (!Number.isInteger(Number(payload.service_type)) || Number(payload.service_type) <= 0)
    errors.service_type = 'เลือกอัตราค่าขนส่ง';
  if (isNaN(payload.cod_amount) || payload.cod_amount < 0)
    errors.cod_amount = 'COD ต้องไม่ติดลบ';
  if (actualWeight !== null && (isNaN(actualWeight) || actualWeight <= 0))
    errors.declared_weight = 'น้ำหนักต้องมากกว่า 0 กก.';
  if ([dimW, dimH, dimD].some(value => !Number.isFinite(value) || value < 0))
    errors.declared_size = 'ขนาดพัสดุต้องเป็นตัวเลข 0 ขึ้นไป';
  if (!Number.isInteger(payload.item_count) || payload.item_count <= 0)
    errors.item_count = 'จำนวนชิ้นต้องมากกว่า 0';
  if (payload.declared_value !== null && (isNaN(payload.declared_value) || payload.declared_value < 0))
    errors.declared_value = 'มูลค่าสินค้าต้องไม่ติดลบ';
  if (payload.cod_amount > 0 && payload.declared_value > 0 &&
      payload.cod_amount > payload.declared_value * 3)
    errors.cod_amount = `COD (${payload.cod_amount.toLocaleString()}) สูงกว่ามูลค่าสินค้า 3x — ตรวจสอบอีกครั้ง`;
  if (!['ORIGIN', 'DESTINATION', 'MONTHLY_BILL'].includes(payload.payment_method))
    errors.payment_method = 'วิธีชำระค่าขนส่งไม่ถูกต้อง';

  if (Object.keys(errors).length > 0) {
    console.log('[DEBUG ORDER CREATE] Validation FAILED:', errors);
    req.session.formDraft = req.body;
    req.session.flash = { type: 'error', message: Object.values(errors).join(' · '), fields: errors };
    return res.redirect('/orders/new');
  }

  try {
    // 3. Verify customers exist
    const [[sender]]   = await pool.query('SELECT id,name,is_credit FROM customers WHERE id=? AND active=1', [payload.sender_id]);
    const [[receiver]] = await pool.query('SELECT id,name FROM customers WHERE id=? AND active=1', [payload.receiver_id]);
    if (!sender) {
      req.session.formDraft = req.body;
      req.session.flash = { type: 'error', message: 'ไม่พบผู้ส่ง กรุณาเลือกใหม่' };
      return res.redirect('/orders/new');
    }
    if (!receiver) {
      req.session.formDraft = req.body;
      req.session.flash = { type: 'error', message: 'ไม่พบผู้รับ กรุณาเลือกใหม่' };
      return res.redirect('/orders/new');
    }
    if (payload.payment_method === 'MONTHLY_BILL' && !sender.is_credit) {
      req.session.formDraft = req.body;
      req.session.flash = { type: 'error', message: `ผู้ส่ง "${sender.name}" ยังไม่ได้เปิดสิทธิ์วางบิล (is_credit)` };
      return res.redirect('/orders/new');
    }

    // 4. Duplicate detection — same sender+receiver+direction in last 2h
    if (!force_duplicate) {
      const [[dup]] = await pool.query(
        `SELECT id, job_no, created_at FROM orders
         WHERE sender_id=? AND receiver_id=? AND direction=?
           AND created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
           AND status NOT IN ('RETURN_TO_SENDER','CLOSED','CUSTOMS_REJECTED')
         ORDER BY created_at DESC LIMIT 1`,
        [payload.sender_id, payload.receiver_id, payload.direction]
      );
      if (dup) {
        req.session.formDraft = { ...req.body, _dup_job: dup.job_no, _dup_id: dup.id, sender_name: sender.name, receiver_name: receiver.name };

        req.session.flash = {
          type: 'warning',
          message: `พบ Order ที่คล้ายกัน: ${dup.job_no} (ผู้ส่ง-ผู้รับเดิม ทิศทางเดิม ภายใน 2 ชม.) — ถ้าต้องการสร้างต่อ กดยืนยัน`,
          dup_job_no: dup.job_no,
          dup_order_id: dup.id,
          force_needed: true,
        };
        return res.redirect('/orders/new');
      }
    }

    // 5. Collision-safe job_no
    if (!payload.job_no) {
      let unique = false;
      let attempts = 0;
      while (!unique && attempts < 5) {
        const now = new Date();
        const yy  = String(now.getFullYear()).slice(-2);
        const mm  = String(now.getMonth() + 1).padStart(2, '0');
        const dd  = String(now.getDate()).padStart(2, '0');
        const seq = String(Math.floor(Math.random() * 9000) + 1000);
        payload.job_no = `SNG-${yy}${mm}${dd}-${seq}`;
        const [[exists]] = await pool.query('SELECT id FROM orders WHERE job_no=?', [payload.job_no]);
        if (!exists) unique = true;
        attempts++;
      }
    } else {
      const [[taken]] = await pool.query('SELECT id FROM orders WHERE job_no=?', [payload.job_no]);
      if (taken) {
        req.session.formDraft = req.body;
        req.session.flash = { type: 'error', message: `รหัส Job "${payload.job_no}" ถูกใช้แล้ว` };
        return res.redirect('/orders/new');
      }
    }

    // 6. Server-authoritative price + atomic insert/log/COD/quotation update.
    const newOrderId = await withTransaction(async conn => {
      const { rate, price } = await resolveShippingRate(conn, {
        rateId: payload.service_type,
        chargeableKg: payload.chargeable_kg || 0,
        dimensionSum: dimW + dimH + dimD,
      });
      payload.price_amount = price;
      payload.service_type = rate.name;

      const [result] = await conn.query(
        `INSERT INTO orders (
          job_no, direction, sender_id, receiver_id,
          price_amount, cod_amount, requires_customs,
          service_type, declared_weight, declared_size,
          declared_value, item_description, notes,
          image_path, created_by,
          source_type, is_fragile, item_count,
          weight_kg, dim_l_cm, dim_w_cm, dim_h_cm, chargeable_kg, payment_method, quotation_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          payload.job_no,          payload.direction,
          payload.sender_id,       payload.receiver_id,
          payload.price_amount,    payload.cod_amount,   payload.requires_customs,
          payload.service_type,    payload.declared_weight, payload.declared_size,
          payload.declared_value,  payload.item_description, payload.notes,
          payload.image_path,      payload.created_by,
          payload.source_type,     payload.is_fragile,   payload.item_count,
          payload.weight_kg,       payload.dim_l_cm,     payload.dim_w_cm,
          payload.dim_h_cm,        payload.chargeable_kg, payload.payment_method, payload.quotation_id
        ]
      );
      await conn.query(
        `INSERT INTO order_status_logs
           (order_id, from_status, to_status, note, action_by, action_at)
         VALUES (?,NULL,'NEW','Order created',?,NOW())`,
        [result.insertId, payload.created_by]
      );
      if (payload.cod_amount > 0) {
        await conn.query(
          `INSERT INTO cod_settlements (order_id, cod_amount, status) VALUES (?,?,'PENDING')`,
          [result.insertId, payload.cod_amount]
        );
      }
      if (payload.quotation_id) {
        await conn.query(
          `UPDATE partner_quotations SET status='ordered'
           WHERE id=? AND status IN ('draft','sent','accepted')`,
          [payload.quotation_id]
        );
      }
      return result.insertId;
    });

    // 9. Done
    delete req.session.formDraft;
    req.session.flash = { type: 'success', message: `สร้าง Order ${payload.job_no} สำเร็จ` };
    res.redirect(`/orders/${newOrderId}`);

  } catch (err) {
    console.error('[DEBUG ORDER CREATE] CATCH:', err.code, err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      req.session.formDraft = req.body;
      req.session.flash = { type: 'error', message: 'รหัส Job ซ้ำ กรุณาเปลี่ยนรหัส' };
      return res.redirect('/orders/new');
    }
    console.error('[Order create]', err);
    req.session.formDraft = req.body;
    req.session.flash = { type: 'error', message: `เกิดข้อผิดพลาด: ${err.message}` };
    res.redirect('/orders/new');
  }
}


export async function detail(req, res) {
  const { id } = req.params;
  const [[order]] = await pool.query(
    `SELECT o.*,
            s.name as sender_name, s.address as sender_address, s.phone as sender_phone, s.id as sender_cid,
            r.name as receiver_name, r.address as receiver_address, r.phone as receiver_phone, r.id as receiver_cid,
            t.trip_no, t.status as trip_status, t.driver_name, t.vehicle as vehicle_no,
            t.origin_border, t.dest_border, t.trip_date, t.direction as trip_direction,
            TIMESTAMPDIFF(HOUR, o.updated_at, NOW()) AS hours_since_update,
            TIMESTAMPDIFF(HOUR, o.created_at, NOW()) AS hours_since_created
     FROM orders o
     LEFT JOIN customers s ON s.id = o.sender_id
     LEFT JOIN customers r ON r.id = o.receiver_id
     LEFT JOIN trips t ON t.id = o.trip_id
     WHERE o.id = ?`,
    [id]
  );
  if (!order) {
    req.session.flash = { type: 'error', message: 'Order not found' };
    return res.redirect('/orders');
  }

  const [logs] = await pool.query(
    `SELECT osl.*, u.username, u.role as action_role
     FROM order_status_logs osl
     LEFT JOIN users u ON u.id = osl.action_by
     WHERE osl.order_id = ?
     ORDER BY osl.action_at DESC`,
    [id]
  );

  const [payments] = await pool.query(
    'SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC',
    [id]
  );

  const [notifications] = await pool.query(
    `SELECT id, channel, event_type, status, attempts, recipient,
            last_error, sent_at, created_at, next_attempt_at
     FROM customer_notification_outbox
     WHERE order_id=? ORDER BY id DESC LIMIT 30`,
    [id]
  );

  // COD settlement state (safe: returns null if no record)
  let codSettlement = null;
  try {
    const [[cs]] = await pool.query(
      `SELECT cs.*, TIMESTAMPDIFF(HOUR, cs.collected_at, NOW()) AS hours_since_collected
       FROM cod_settlements cs WHERE cs.order_id = ? LIMIT 1`,
      [id]
    );
    codSettlement = cs || null;
  } catch (_) {}

  // Time order has been in CUSTOMS_HOLD
  let customsHoldLog = null;
  try {
    const [[chl]] = await pool.query(
      `SELECT action_at, TIMESTAMPDIFF(HOUR, action_at, NOW()) AS hours_held
       FROM order_status_logs
       WHERE order_id = ? AND to_status = 'CUSTOMS_HOLD'
       ORDER BY action_at DESC LIMIT 1`,
      [id]
    );
    customsHoldLog = chl || null;
  } catch (_) {}

  // Order flags (Phase 2: Screening results)
  let orderFlags = [];
  try {
    const [flagRows] = await pool.query(
      `SELECT f.*, u.username AS flagged_by_name
       FROM order_flags f
       LEFT JOIN users u ON u.id = f.flagged_by
       WHERE f.order_id = ?
       ORDER BY f.flagged_at ASC`,
      [id]
    );
    orderFlags = flagRows || [];
  } catch (_) {}

  const flash = req.session.flash || null;
  delete req.session.flash;

  // Build can permissions
  const role = req.session.user?.role || '';
  const can = {
    viewRevenue:   ['admin','manager','finance','dispatcher'].includes(role),
    viewFinancials:['admin','manager','finance'].includes(role),
    manageCustoms: ['admin','manager','dispatcher'].includes(role),
    resolveFlag:   ['admin','manager','dispatcher','warehouse_th','thai_warehouse'].includes(role),

  };

  // Active branches — used by the "ลงสาขา" action at the destination office
  let branches = [];
  try {
    const [b] = await pool.query("SELECT id, branch_code, name FROM branches WHERE status='active' ORDER BY name");
    branches = b;
  } catch (_) {}

  res.render('orders/detail', {
    order,
    logs,
    payments,
    notifications,
    codSettlement,
    customsHoldLog,
    orderFlags,
    branches,
    flash,
    can,
    user: req.session.user,
    title: `Order ${order.job_no}`,
    error: null
  });
}

// ── Shared: complete an order at the destination office (self-pickup / forward) ──
// Transitions AT_DEST_WH → DELIVERED and, if the order has COD, records the
// collected amount and moves it to COD_COLLECTED — all inside the given conn.
async function completeOrderAtOffice(conn, order, { recipientName, codCollected, note, userId }) {
  await transitionOrder({
    orderId: order.id,
    toStatus: 'DELIVERED',
    userId,
    note,
    source: 'ORDER_OFFICE_COMPLETE',
    updates: {
      recipient_name: recipientName || null,
      delivered_by: userId || null,
      cod_collected_amount: codCollected || 0,
    },
    connection: conn,
  });
  if (Number(order.cod_amount) > 0) {
    await conn.query(
      `INSERT INTO cod_settlements (order_id, cod_amount, status, collected_at)
       VALUES (?, ?, 'COLLECTED', NOW())
       ON DUPLICATE KEY UPDATE status='COLLECTED', collected_at=NOW(), cod_amount=VALUES(cod_amount)`,
      [order.id, order.cod_amount]
    );
    await transitionOrder({
      orderId: order.id,
      toStatus: 'COD_COLLECTED',
      userId,
      note: 'COD collected at office',
      source: 'ORDER_OFFICE_COD',
      connection: conn,
      notify: false,
    });
  }
}

// ── POST /orders/:id/to-branch — ลงสาขา (hand to a sub-branch) ─────────────────
export async function sendToBranch(req, res) {
  const { id } = req.params;
  const branchId = Number(req.body.branch_id);
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'ไม่พบออเดอร์' };
    return res.redirect('/orders');
  }
  if (order.status !== 'AT_DEST_WH') {
    req.session.flash = { type: 'error', message: 'ออเดอร์ยังไม่พร้อมลงสาขา (ต้องอยู่สถานะ "ถึงคลังปลายทาง")' };
    return res.redirect(`/orders/${id}`);
  }
  if (!Number.isInteger(branchId) || branchId <= 0) {
    req.session.flash = { type: 'error', message: 'กรุณาเลือกสาขาปลายทาง' };
    return res.redirect(`/orders/${id}`);
  }
  try {
    await withTransaction(async (conn) => {
      await assignOrderToBranch(id, branchId, conn);
      await transitionOrder({
        orderId: id, toStatus: 'BRANCH_TRANSFER', userId: req.session.user?.id,
        note: 'ส่งต่อไปสาขา', source: 'ORDER_TO_BRANCH', connection: conn,
      });
    });
    kickNotificationWorker(id);
    req.session.flash = { type: 'success', message: 'ส่งต่อไปสาขาแล้ว' };
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
  }
  res.redirect(`/orders/${id}`);
}

// ── POST /orders/:id/pickup-at-office — ลูกค้ามารับที่สำนักงาน ──────────────────
export async function pickupAtOffice(req, res) {
  const { id } = req.params;
  const recipientName = String(req.body.recipient_name || '').trim();
  const codCollected = Number(req.body.cod_collected || 0);
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'ไม่พบออเดอร์' };
    return res.redirect('/orders');
  }
  if (order.status !== 'AT_DEST_WH') {
    req.session.flash = { type: 'error', message: 'ออเดอร์ยังไม่พร้อมรับที่สำนักงาน' };
    return res.redirect(`/orders/${id}`);
  }
  if (!recipientName) {
    req.session.flash = { type: 'error', message: 'กรุณาระบุชื่อผู้มารับ' };
    return res.redirect(`/orders/${id}`);
  }
  if (Number(order.cod_amount) > 0 && Math.abs(codCollected - Number(order.cod_amount)) > 0.01) {
    req.session.flash = { type: 'error', message: `ยอด COD ต้องเท่ากับ ${Number(order.cod_amount)}` };
    return res.redirect(`/orders/${id}`);
  }
  try {
    await withTransaction(async (conn) => {
      await completeOrderAtOffice(conn, order, {
        recipientName, codCollected,
        note: `ลูกค้ามารับที่สำนักงาน (${recipientName})`,
        userId: req.session.user?.id,
      });
    });
    kickNotificationWorker(id);
    req.session.flash = { type: 'success', message: 'บันทึกลูกค้ามารับที่สำนักงานแล้ว' };
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
  }
  res.redirect(`/orders/${id}`);
}

// ── POST /orders/:id/forward — ส่งต่อขนส่งเจ้าอื่น (ต่างแขวง) + ค่าบริการ ─────────
export async function forwardThirdParty(req, res) {
  const { id } = req.params;
  const courier = String(req.body.courier_name || '').trim();
  const province = String(req.body.province || '').trim();
  const feeAmount = Number(req.body.fee_amount || 0);
  const recipientName = String(req.body.recipient_name || '').trim() || courier;
  const codCollected = Number(req.body.cod_collected || 0);
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'ไม่พบออเดอร์' };
    return res.redirect('/orders');
  }
  if (order.status !== 'AT_DEST_WH') {
    req.session.flash = { type: 'error', message: 'ออเดอร์ยังไม่พร้อมส่งต่อ' };
    return res.redirect(`/orders/${id}`);
  }
  if (!courier) {
    req.session.flash = { type: 'error', message: 'กรุณาระบุชื่อขนส่งเจ้าอื่น' };
    return res.redirect(`/orders/${id}`);
  }
  if (!Number.isFinite(feeAmount) || feeAmount < 0) {
    req.session.flash = { type: 'error', message: 'ค่าบริการไม่ถูกต้อง' };
    return res.redirect(`/orders/${id}`);
  }
  if (Number(order.cod_amount) > 0 && Math.abs(codCollected - Number(order.cod_amount)) > 0.01) {
    req.session.flash = { type: 'error', message: `ยอด COD ต้องเท่ากับ ${Number(order.cod_amount)}` };
    return res.redirect(`/orders/${id}`);
  }
  try {
    await withTransaction(async (conn) => {
      const note = `ส่งต่อขนส่ง ${courier}${province ? ' ไปแขวง ' + province : ''}` +
        (feeAmount > 0 ? ` (ค่าบริการ ${feeAmount})` : '');
      await completeOrderAtOffice(conn, order, {
        recipientName, codCollected, note, userId: req.session.user?.id,
      });
      if (feeAmount > 0) {
        const ref = `ค่าส่งต่อขนส่ง ${courier}${province ? ' (' + province + ')' : ''}`.slice(0, 120);
        await conn.query(
          `INSERT INTO payments (order_id, type, method, amount, currency, status, paid_at, ref_no)
           VALUES (?, 'fee', 'cash', ?, 'THB', 'PAID', NOW(), ?)`,
          [id, feeAmount, ref]
        );
      }
    });
    kickNotificationWorker(id);
    req.session.flash = { type: 'success', message: 'บันทึกส่งต่อขนส่งเจ้าอื่นแล้ว' };
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
  }
  res.redirect(`/orders/${id}`);
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
  const isThaiWH = user && ['warehouse_th','thai_warehouse'].includes(user.role);
  const isLaoWH  = user && ['warehouse_la','lao_warehouse'].includes(user.role);

  if (isThaiWH && toStatus !== 'RECEIVED_WH_TH') {
    req.session.flash = { type: 'error', message: 'คลังไทยรับได้เฉพาะ order TH→LA' };
    return res.redirect(`/orders/${id}`);
  }

  if (isLaoWH && toStatus !== 'RECEIVED_WH_LA') {
    req.session.flash = { type: 'error', message: 'คลังลาวรับได้เฉพาะ order LA→TH' };
    return res.redirect(`/orders/${id}`);
  }

  // ── Transition validation ──
  if (!validateTransition(req, res, order, toStatus)) return;

  try {
    await transitionOrder({ orderId: id, toStatus, userId: req.session.user?.id,
      note: 'Received into warehouse', source: 'ORDER_RECEIVE' });

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
  if (!canTransitionOrder(order.status, 'CROSSING_BORDER')) {
    req.session.flash = { type: 'error', message: 'Not ready for CROSSING_BORDER' };
    return res.redirect(`/orders/${id}`);
  }

  try {
    await transitionOrder({ orderId: id, toStatus: 'CROSSING_BORDER', userId: req.session.user?.id,
      note: 'Departed to border', source: 'ORDER_CROSSING' });
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
    await transitionOrder({ orderId: id, toStatus: 'ARRIVED_BORDER_WH', userId: req.session.user?.id,
      note: 'Arrived border warehouse', source: 'ORDER_BORDER_ARRIVAL' });
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
    await transitionOrder({
      orderId: id,
      toStatus: 'AT_DEST_WH',
      userId: req.session.user?.id,
      note: 'Received destination warehouse',
      source: 'ORDER_DESTINATION_ARRIVAL',
      afterTransition: conn => assignBranchToOrder(id, conn),
    });


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
    await transitionOrder({ orderId: id, toStatus: 'OUT_FOR_DELIVERY', userId: req.session.user?.id,
      note: 'Out for delivery', source: 'ORDER_DELIVERY' });

    // ไม่แจ้ง WhatsApp ที่จุดนี้



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
  const recipientName = String(req.body.recipient_name || '').trim();
  if (!recipientName || !req.file) {
    req.session.flash = { type: 'error', message: 'กรุณาระบุชื่อผู้รับและแนบภาพหลักฐาน POD' };
    return res.redirect(`/orders/${id}`);
  }
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
    const imgPath = '/uploads/orders/' + req.file.filename;
    const note = `ส่งสำเร็จถึง ${recipientName} (บันทึกภาพ ${req.file.originalname})`;
    const updates = {
      delivered_by: req.session.user?.id || null,
      recipient_name: recipientName,
      delivery_proof_image: imgPath,
      pod_photo_url: imgPath,
    };

    await transitionOrder({ orderId: id, toStatus: 'DELIVERED', userId: req.session.user?.id,
      note, source: 'ORDER_DELIVERED', updates });


    req.session.flash = { type: 'success', message: 'บันทึกการจัดส่งสำเร็จแล้ว' };
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

export async function markDeliveryFailed(req, res) {
  const { id } = req.params;
  const { fail_reason, fail_note } = req.body;
  
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'Order not found' };
    return res.redirect('/orders');
  }
  if (order.status !== 'OUT_FOR_DELIVERY') {
    req.session.flash = { type: 'error', message: 'Not currently OUT_FOR_DELIVERY' };
    return res.redirect(`/orders/${id}`);
  }

  try {
    let note = `เหตุผล: ${fail_reason}`;
    if (fail_note) note += ` (${fail_note})`;

    await transitionOrder({
      orderId: id,
      toStatus: 'DELIVERY_FAILED',
      userId: req.session.user?.id,
      note,
      source: 'ORDER_DELIVERY_FAILED',
      updates: { fail_reason: fail_reason || 'OTHER', fail_note: fail_note || null },
      afterTransition: conn => conn.query('UPDATE orders SET fail_count=fail_count+1 WHERE id=?', [id]),
    });

    req.session.flash = { type: 'error', message: 'บันทึกการส่งมอบไม่สำเร็จ' };
    res.redirect(`/orders/${id}`);
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
    res.redirect(`/orders/${id}`);
  }
}

export async function closeOrder(req, res) {
  const { id } = req.params;
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'Order not found' };
    return res.redirect('/orders');
  }
  if (!['DELIVERED', 'COD_REMITTED', 'CUSTOMS_REJECTED', 'RETURN_TO_SENDER'].includes(order.status)) {
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
    await transitionOrder({ orderId: id, toStatus: 'CLOSED', userId: req.session.user?.id,
      note: 'Order closed', source: 'ORDER_CLOSE' });
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

// ─── Delete order — OWNER ONLY, permanent (test-data cleanup, not for production use) ─
export async function deleteOrder(req, res) {
  const { id } = req.params;
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'ไม่พบออเดอร์นี้' };
    return res.redirect('/orders');
  }

  try {
    await withTransaction(async (conn) => {
      // Tables below have no ON DELETE CASCADE from orders (verified against
      // information_schema.REFERENTIAL_CONSTRAINTS — most are NO ACTION, and
      // delivery_events has no FK at all despite what the migration file says),
      // so they must be cleared explicitly before the order row can be removed.
      // Only delivery_offers/delivery_offer_recipients (ON DELETE CASCADE) and
      // crm_cases.related_order_id (ON DELETE SET NULL) are handled by the DB.
      await conn.query('DELETE FROM delivery_events WHERE order_id = ?', [id]);
      await conn.query(
        `DELETE br FROM branch_revenue br
         JOIN branch_deliveries bd ON bd.id = br.delivery_id
         WHERE bd.order_id = ?`, [id]
      );
      await conn.query('DELETE FROM branch_deliveries WHERE order_id = ?', [id]);
      await conn.query('DELETE FROM order_status_logs WHERE order_id = ?', [id]);
      await conn.query('DELETE FROM trip_orders WHERE order_id = ?', [id]);
      await conn.query('DELETE FROM payments WHERE order_id = ?', [id]);
      await conn.query('DELETE FROM cod_settlements WHERE order_id = ?', [id]);
      await conn.query('DELETE FROM order_flags WHERE order_id = ?', [id]);
      await conn.query('DELETE FROM dispatch_assignments WHERE order_id = ?', [id]);
      await conn.query('DELETE FROM customer_notification_outbox WHERE order_id = ?', [id]);
      await conn.query('UPDATE partner_quotations SET order_id = NULL WHERE order_id = ?', [id]);
      await conn.query('DELETE FROM orders WHERE id = ?', [id]);
    });

    console.warn(`[deleteOrder] ${order.job_no} (id=${id}) permanently deleted by ${req.session.user?.username || 'unknown'}`);
    req.session.flash = { type: 'success', message: `ลบออเดอร์ ${order.job_no} เรียบร้อยแล้ว` };
    return res.redirect('/orders');
  } catch (err) {
    console.error('[deleteOrder] failed:', err);
    req.session.flash = { type: 'error', message: 'ลบออเดอร์ไม่สำเร็จ: ' + err.message };
    return res.redirect(`/orders/${id}`);
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

  const [[rateRow]] = await pool.query('SELECT rate FROM exchange_rates WHERE pair = "THB_LAK" ORDER BY created_at DESC LIMIT 1');
  const exchangeRate = rateRow ? Number(rateRow.rate) : 700;

  const [settingRows] = await pool.query('SELECT setting_key, setting_value FROM company_settings');
  const company = Object.fromEntries(settingRows.map(r => [r.setting_key, r.setting_value]));

  res.render('orders/waybill', {
    layout: false,
    order,
    exchangeRate,
    company,
    user: req.session.user
  });
}

export async function showPrint(req, res) {
  try {
    const { id } = req.params;

    const [[order]] = await pool.query(
      `SELECT o.*, 
              s.name AS sender_name, s.phone AS sender_phone, 
              s.address AS sender_address, s.city AS sender_city, 
              s.province AS sender_province,
              r.name AS receiver_name, r.phone AS receiver_phone,
              r.address AS receiver_address, r.city AS receiver_city,
              r.province AS receiver_province
       FROM orders o
       LEFT JOIN customers s ON o.sender_id = s.id
       LEFT JOIN customers r ON o.receiver_id = r.id
       WHERE o.id = ?`,
      [id]
    );

    if (!order) return res.status(404).send('Order not found');

    const [[customs]] = await pool.query(
      'SELECT amount FROM payments WHERE order_id = ? AND type = "customs" LIMIT 1',
      [id]
    );

    const [[rateRow]] = await pool.query('SELECT rate FROM exchange_rates WHERE pair = "THB_LAK" ORDER BY created_at DESC LIMIT 1');
    const exchangeRate = rateRow ? Number(rateRow.rate) : 700;

    const [settingRows] = await pool.query('SELECT setting_key, setting_value FROM company_settings');
    const company = Object.fromEntries(settingRows.map(r => [r.setting_key, r.setting_value]));

    res.render('orders/print', {
      layout: false,
      order,
      sender: {
        name: order.sender_name,
        phone: order.sender_phone,
        address: order.sender_address,
        city: order.sender_city,
        province: order.sender_province
      },
      receiver: {
        name: order.receiver_name,
        phone: order.receiver_phone,
        address: order.receiver_address,
        city: order.receiver_city,
        province: order.receiver_province
      },
      exchangeRate,
      customs: customs || { amount: 0 },
      company
    });
  } catch (error) {
    console.error('Print view error:', error);
    res.status(500).send('Error generating print view: ' + error.message);
  }
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
      await transitionOrder({ orderId: order.id, toStatus: nextStatus,
        userId: req.session.user?.id, note: logNote, source: 'LEGACY_SCANNER' });
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

  const [customers] = await pool.query("SELECT id, name, type, is_credit FROM customers WHERE active = 1 ORDER BY name ASC");
  const [shippingRates] = await pool.query(
    'SELECT * FROM shipping_rates WHERE active=1 ORDER BY price ASC, max_weight ASC'
  );

  res.render('orders/edit', {
    user: req.session.user,
    customers,
    shippingRates,
    order,
    error: null,
    title: `แก้ไขออเดอร์ ${order.job_no}`
  });
}

export async function update(req, res) {
  const { id } = req.params;
  const {
    direction, sender_id, receiver_id,
    cod_amount, requires_customs,
    service_type, declared_weight, declared_size, declared_value,
    payment_method
  } = req.body;

  try {
    const weight = declared_weight === '' || declared_weight == null ? 0 : Number(declared_weight);
    const dimensionSum = parseDimensionSum(declared_size);
    const dimensionParts = declared_size
      ? String(declared_size).trim().split(/[xX×,*\s]+/).filter(Boolean).map(Number)
      : [];
    const volumetricWeight = dimensionParts.length === 3
      ? (dimensionParts[0] * dimensionParts[1] * dimensionParts[2]) / 5000
      : 0;
    const payload = {
      direction: String(direction || '').toUpperCase(),
      sender_id: sender_id ? Number(sender_id) : null,
      receiver_id: receiver_id ? Number(receiver_id) : null,
      payment_method: payment_method || 'ORIGIN',
      cod_amount: cod_amount ? Number(cod_amount) : 0,
      requires_customs: requires_customs ? 1 : 0,
      service_type,
      declared_weight: weight || null,
      declared_size: declared_size ? String(declared_size).trim() : null,
      declared_value: declared_value ? Number(declared_value) : null
    };

    if (!allowedDirections.includes(payload.direction)) throw new Error('Invalid direction');
    if (!payload.sender_id || !payload.receiver_id || payload.sender_id === payload.receiver_id) {
      throw new Error('Sender and receiver must be valid and different');
    }
    if (!Number.isFinite(weight) || weight < 0) throw new Error('Invalid weight');
    if (!Number.isFinite(payload.cod_amount) || payload.cod_amount < 0) throw new Error('Invalid COD amount');
    if (!['ORIGIN', 'DESTINATION', 'MONTHLY_BILL'].includes(payload.payment_method)) throw new Error('Invalid payment method');
    if (payload.declared_value !== null && (!Number.isFinite(payload.declared_value) || payload.declared_value < 0)) {
      throw new Error('Invalid declared value');
    }

    await withTransaction(async conn => {
      const [[order]] = await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE', [id]);
      if (!order) throw new Error('Order not found');
      if (!['NEW', 'RECEIVED_WH_TH', 'RECEIVED_WH_LA'].includes(order.status)) {
        throw new Error('Order details can only be edited before loading onto a trip');
      }
      const [customers] = await conn.query(
        'SELECT id, is_credit FROM customers WHERE active=1 AND id IN (?,?)',
        [payload.sender_id, payload.receiver_id]
      );
      if (customers.length !== 2) throw new Error('Sender or receiver is inactive');
      if (payload.payment_method === 'MONTHLY_BILL') {
        const senderRow = customers.find(c => c.id === payload.sender_id);
        if (!senderRow?.is_credit) throw new Error('Sender is not credit-approved (is_credit=0)');
      }

      const chargeableKg = Math.max(weight, volumetricWeight);
      const { rate, price } = await resolveShippingRate(conn, {
        rateId: payload.service_type,
        chargeableKg,
        dimensionSum,
      });

      await conn.query(
        `UPDATE orders SET
          direction=?, sender_id=?, receiver_id=?,
          price_amount=?, payment_method=?, cod_amount=?, requires_customs=?,
          service_type=?, declared_weight=?, declared_size=?, declared_value=?,
          weight_kg=?, chargeable_kg=?
         WHERE id=?`,
        [
          payload.direction, payload.sender_id, payload.receiver_id,
          price, payload.payment_method, payload.cod_amount, payload.requires_customs,
          rate.name, payload.declared_weight, payload.declared_size, payload.declared_value,
          payload.declared_weight, chargeableKg || null, id,
        ]
      );

      if (payload.cod_amount > 0) {
        await conn.query(
          `INSERT INTO cod_settlements (order_id, cod_amount, status)
           VALUES (?,?,'PENDING')
           ON DUPLICATE KEY UPDATE
             cod_amount=IF(status='PENDING', VALUES(cod_amount), cod_amount)`,
          [id, payload.cod_amount]
        );
      } else {
        await conn.query(
          "DELETE FROM cod_settlements WHERE order_id=? AND status='PENDING'",
          [id]
        );
      }
      await conn.query(
        `INSERT INTO order_status_logs
           (order_id, from_status, to_status, note, action_by, action_at)
         VALUES (?,?,?,?,?,NOW())`,
        [id, order.status, order.status, 'Order details updated', req.session.user?.id || null]
      );
    });

    req.session.flash = { type: 'success', message: 'อัปเดตข้อมูลสำเร็จ' };
    res.redirect(`/orders/${id}`);

  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
    res.redirect(`/orders/${id}/edit`);
  }
}

/**
 * POST /orders/:id/return
 * เปลี่ยนสถานะเป็น RETURN_TO_SENDER (จาก DELIVERY_FAILED)
 * สำหรับ dispatcher/manager ที่ตัดสินใจไม่ส่งต่อ
 */
export async function returnToSender(req, res) {
  const { id } = req.params;
  try {
    await transitionOrder({
      orderId: id,
      toStatus: 'RETURN_TO_SENDER',
      userId: req.session.user?.id,
      note: req.body.reason || 'คืนสินค้าผู้ส่ง',
      source: 'ORDER_RETURN',
    });

    req.session.flash = { type: 'success', message: 'Order set to Return to Sender' };
    res.redirect(`/orders/${id}`);
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
    res.redirect(`/orders/${id}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: WAREHOUSE SCREENING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /orders/:id/screen
 * Body: { result: 'PASSED'|'CUSTOMS_REQUIRED'|'REJECTED', note, flags[] }
 *
 * Auto-flags based on category keywords if flags[] not provided.
 */
export async function screenOrder(req, res) {
  const { id } = req.params;
  const { result, note, flags } = req.body;
  const userId = req.session.user?.id;

  const VALID_RESULTS = ['PASSED', 'CUSTOMS_REQUIRED', 'REJECTED'];
  if (!VALID_RESULTS.includes(result)) {
    req.session.flash = { type: 'error', message: 'ผลการตรวจสอบไม่ถูกต้อง' };
    return res.redirect(`/orders/${id}`);
  }

  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    req.session.flash = { type: 'error', message: 'ไม่พบ Order' };
    return res.redirect('/orders');
  }

  try {
    const flagList = Array.isArray(flags) ? flags : (flags ? [flags] : []);
    const noteMsg = result === 'PASSED'
      ? `ผ่านการคัดกรอง${flagList.length ? ' (มี flag: ' + flagList.join(', ') + ')' : ''}`
      : result === 'CUSTOMS_REQUIRED'
        ? `ต้องแจ้งศุลกากร: ${note || ''}`
        : `ปฏิเสธสินค้า: ${note || ''}`;

    await withTransaction(async (conn) => {
      await conn.query(
        `UPDATE orders SET screening_status=?, screening_note=?, screened_by=?, screened_at=NOW()
         WHERE id=?`,
        [result, note || null, userId, id]
      );
      for (const flagType of flagList) {
        await conn.query(
          `INSERT INTO order_flags (order_id, flag_type, flagged_by) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE flagged_at=NOW()`,
          [id, flagType, userId]
        );
      }
      const [logResult] = await conn.query(
        `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
         VALUES (?, ?, ?, ?, ?)`,
        [id, order.status, order.status, `[SCREENING:${result}] ${noteMsg}`, userId]
      );
      if (result !== 'PASSED') {
        await enqueueOrderNotification(conn, {
          orderId: id,
          status: `SCREENING_${result}`,
          eventKey: `ORDER_STATUS_LOG:${logResult.insertId}`,
          source: 'ORDER_SCREENING',
        });
      }
    });
    if (result !== 'PASSED') kickNotificationWorker(id);

    const msgs = {
      PASSED:            '✅ ผ่านการคัดกรอง — พร้อมพิมพ์ Sticker',
      CUSTOMS_REQUIRED:  '⚠️ ต้องดำเนินการด้านศุลกากรก่อน',
      REJECTED:          '❌ ปฏิเสธสินค้า — แจ้งลูกค้าแล้ว',
    };
    req.session.flash = { type: result === 'PASSED' ? 'success' : result === 'REJECTED' ? 'error' : 'warning',
                          message: msgs[result] };
    res.redirect(`/orders/${id}`);
  } catch (err) {
    console.error('[screenOrder]', err);
    req.session.flash = { type: 'error', message: err.message };
    res.redirect(`/orders/${id}`);
  }
}

/**
 * POST /orders/:id/print-sticker
 * Marks sticker_printed_at = NOW() and logs the action.
 */
export async function printSticker(req, res) {
  const { id } = req.params;
  const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    await pool.query(
      'UPDATE orders SET sticker_printed_at = NOW() WHERE id = ?', [id]
    );
    await logStatus(id, order.status, order.status,
      'พิมพ์ Sticker SNG แล้ว', req.session.user?.id);

    // ถ้า client ต้องการ JSON (AJAX call)
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ ok: true, printed_at: new Date() });
    }

    req.session.flash = { type: 'success', message: '🖨️ พิมพ์ Sticker เรียบร้อย' };
    res.redirect(`/orders/${id}`);
  } catch (err) {
    console.error('[printSticker]', err);
    req.session.flash = { type: 'error', message: err.message };
    res.redirect(`/orders/${id}`);
  }
}

/**
 * GET /orders/:id/sticker
 * Returns a printable HTML sticker label (A6/thermal 80mm)
 * Includes: barcode (job_no), QR (tracking URL), sender/receiver, COD, weight, flags
 */
export async function showSticker(req, res) {
  const { id } = req.params;

  const [[order]] = await pool.query(
    `SELECT o.*,
            s.name AS sender_name, s.phone AS sender_phone,
            s.address AS sender_address, s.province AS sender_province,
            r.name AS receiver_name, r.phone AS receiver_phone,
            r.address AS receiver_address, r.city AS receiver_city,
            r.province AS receiver_province, r.district AS receiver_district,
            t.trip_no, t.vehicle_plate, t.trip_date,
            t.border_checkpoint
     FROM orders o
     LEFT JOIN customers s ON o.sender_id  = s.id
     LEFT JOIN customers r ON o.receiver_id = r.id
     LEFT JOIN trips t     ON o.trip_id    = t.id
     WHERE o.id = ?`,
    [id]
  );

  if (!order) return res.status(404).send('Order not found');

  // Load flags
  const [flags] = await pool.query(
    'SELECT flag_type FROM order_flags WHERE order_id = ? AND resolved = 0', [id]
  );
  const flagTypes = flags.map(f => f.flag_type);

  const [[rateRow]] = await pool.query('SELECT rate FROM exchange_rates WHERE pair = "THB_LAK" ORDER BY created_at DESC LIMIT 1');
  const exchangeRate = rateRow ? Number(rateRow.rate) : 700;

  res.render('orders/sticker', {
    layout: false,
    order,
    flagTypes,
    exchangeRate,
    trackingUrl: `${req.protocol}://${req.get('host')}/track/${order.job_no}`,
    user: req.session.user,
    lang: req.query.lang || 'la',
    title: `Sticker — ${order.job_no}`,
  });
}

/**
 * POST /orders/:id/flags/:flagId/resolve
 * Marks a single order_flag as resolved.
 */
export async function resolveFlag(req, res) {
  const { id, flagId } = req.params;
  const userId = req.session.user?.id;

  try {
    const [result] = await pool.query(
      `UPDATE order_flags
       SET resolved = 1, resolved_by = ?, resolved_at = NOW()
       WHERE id = ? AND order_id = ?`,
      [userId, flagId, id]
    );

    if (result.affectedRows === 0) {
      req.session.flash = { type: 'error', message: 'ไม่พบ Flag นี้' };
      return res.redirect(`/orders/${id}`);
    }

    await logStatus(id, null, null,
      `แก้ไข Flag #${flagId} แล้ว`, userId);

    req.session.flash = { type: 'success', message: '✅ แก้ไข Flag เรียบร้อย' };
    res.redirect(`/orders/${id}`);
  } catch (err) {
    console.error('[resolveFlag]', err);
    req.session.flash = { type: 'error', message: err.message };
    res.redirect(`/orders/${id}`);
  }
}
