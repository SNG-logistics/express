import pool from './src/config/db.js';

async function test() {
  try {
    const [result] = await pool.query(
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
        'SNG-TEST-001', 'TH_TO_LA', 
        1, 2, // Assuming sender_id 1 and receiver_id 2 exist
        100, 0, 0,
        'standard', 1, '10x10x10',
        0, 'test', 'test',
        null, 1,
        'WALKIN', 0, 1,
        1, 10, 10, 10, 1, 'ORIGIN', null
      ]
    );
    console.log("Success!", result);
  } catch (err) {
    console.error("Failed:", err);
  } finally {
    process.exit(0);
  }
}

test();
