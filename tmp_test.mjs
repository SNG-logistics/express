import pool from './src/config/db.js';
async function test() {
  try {
    const [res] = await pool.query(
      `INSERT INTO orders (
        job_no, direction, sender_id, receiver_id,
        price_amount, cod_amount, requires_customs,
        service_type, declared_weight, declared_size,
        declared_value, item_description, notes,
        image_path, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        'SNG-TESTX-01', 'TH_TO_LA', 3, 4,
        350, 0, 0,
        'A+', 2.5, null,
        null, 'Test clothes', null,
        null, 1
      ]
    );
    console.log('Success:', res);
  } catch (e) {
    console.error('Insert Failed:', e.message);
  }
  process.exit();
}
test();
