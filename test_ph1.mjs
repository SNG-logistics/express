import pool from './src/config/db.js';

const jobNo = 'PH1-TEST-' + Date.now().toString(36).toUpperCase();
const [result] = await pool.query(
  `INSERT INTO orders (
    job_no, direction, sender_id, receiver_id,
    price_amount, cod_amount, requires_customs,
    service_type, declared_weight, declared_size,
    declared_value, item_description, notes,
    image_path, created_by,
    source_type, is_fragile, item_count,
    weight_kg, dim_l_cm, dim_w_cm, dim_h_cm, chargeable_kg
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [
    jobNo, 'TH_TO_LA', 1, 2,
    350, 0, 0,
    null, 2.5, '30x20x15',
    1000, 'เสื้อผ้า 2 ตัว (Phase1 Test)', null,
    null, 1,
    'LAZADA', 1, 2,
    2.5, 15, 30, 20, 2.5
  ]
);
console.log('✅ Order created:', jobNo, 'ID:', result.insertId);

const [[order]] = await pool.query(
  'SELECT source_type, is_fragile, item_count, weight_kg, dim_l_cm, dim_w_cm, dim_h_cm, chargeable_kg FROM orders WHERE id = ?',
  [result.insertId]
);
console.log('📦 Saved:', JSON.stringify(order, null, 2));

const ok = order.source_type === 'LAZADA'
  && order.is_fragile === 1
  && order.item_count === 2
  && Number(order.weight_kg) === 2.5
  && Number(order.dim_l_cm) === 15
  && Number(order.dim_w_cm) === 30
  && Number(order.dim_h_cm) === 20
  && Number(order.chargeable_kg) === 2.5;

console.log(ok ? '✅ ALL PHASE 1 FIELDS SAVED CORRECTLY!' : '❌ SOME FIELDS ARE WRONG');
process.exit();
