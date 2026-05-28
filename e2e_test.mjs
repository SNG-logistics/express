/**
 * E2E Pipeline Test — Full Order Lifecycle
 *
 * Tests the complete pipeline:
 * NEW → RECEIVED_WH_TH → ON_TRUCK → CROSSING_BORDER → ARRIVED_BORDER_WH
 *     → AT_DEST_WH → OUT_FOR_DELIVERY → DELIVERED → CLOSED
 *
 * Also tests: Trip creation, order attach, and COD settlement
 */
import pool from './src/config/db.js';
import { canTransitionOrder, canTransitionTrip } from './src/constants/transitions.js';

const LOG = (icon, msg) => console.log(`  ${icon}  ${msg}`);
const PASS = (msg) => LOG('✅', msg);
const FAIL = (msg) => { LOG('❌', msg); process.exitCode = 1; };
const INFO = (msg) => LOG('ℹ️ ', msg);

let orderId, tripId, jobNo;

async function logStatus(orderId, from, to, note) {
  await pool.query(
    `INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
     VALUES (?, ?, ?, ?, 1)`,
    [orderId, from, to, note]
  );
}

async function updateOrderStatus(id, from, to) {
  if (!canTransitionOrder(from, to)) {
    FAIL(`Transition ${from} → ${to} is NOT allowed by rules`);
    return false;
  }
  await pool.query('UPDATE orders SET status = ? WHERE id = ?', [to, id]);
  await logStatus(id, from, to, `[E2E TEST] ${from} → ${to}`);
  PASS(`${from} → ${to}`);
  return true;
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║    SNG Logistics — E2E Pipeline Test         ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Create Order
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('── STEP 1: Create Test Order ──────────────────');
  
  // Ensure we have test customers
  const [[sender]] = await pool.query('SELECT id FROM customers WHERE active=1 LIMIT 1');
  const [[receiver]] = await pool.query('SELECT id FROM customers WHERE active=1 AND id != ? LIMIT 1', [sender?.id || 0]);
  
  if (!sender || !receiver) {
    FAIL('Need at least 2 active customers in DB. Create them first.');
    process.exit(1);
  }

  jobNo = `E2E-TEST-${Date.now().toString(36).toUpperCase()}`;
  const [insertResult] = await pool.query(
    `INSERT INTO orders (job_no, direction, sender_id, receiver_id, price_amount, cod_amount, requires_customs, declared_weight, status, created_by)
     VALUES (?, 'TH_TO_LA', ?, ?, 350, 500, 0, 3.5, 'NEW', 1)`,
    [jobNo, sender.id, receiver.id]
  );
  orderId = insertResult.insertId;
  await logStatus(orderId, null, 'NEW', 'E2E Order created');
  PASS(`Order created: ${jobNo} (id=${orderId})`);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Receive at Thai Warehouse
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── STEP 2: Receive at Thai Warehouse ─────────');
  if (!await updateOrderStatus(orderId, 'NEW', 'RECEIVED_WH_TH')) return;

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Create Trip + Attach Order + Handoff (ON_TRUCK)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── STEP 3: Create Trip + Attach + Handoff ────');
  
  const tripNo = `TRIP-${Date.now().toString(36).toUpperCase()}`;
  const [tripInsert] = await pool.query(
    `INSERT INTO trips (trip_no, direction, trip_date, vehicle, driver_name, origin_border, dest_border, status)
     VALUES (?, 'TH_TO_LA', CURDATE(), 'กท-1234', 'คนขับทดสอบ', 'หนองคาย', 'เวียงจันทน์', 'PLANNED')`,
    [tripNo]
  );
  tripId = tripInsert.insertId;
  PASS(`Trip created: ${tripNo} (id=${tripId})`);

  // Attach order to trip
  await pool.query(
    `INSERT INTO trip_orders (trip_id, order_id) VALUES (?, ?)`,
    [tripId, orderId]
  );
  await pool.query('UPDATE orders SET trip_id = ? WHERE id = ?', [tripId, orderId]);
  PASS(`Order ${jobNo} attached to Trip ${tripNo}`);

  // Trip: PLANNED → LOADING
  if (!canTransitionTrip('PLANNED', 'LOADING')) {
    FAIL('Trip PLANNED → LOADING not allowed');
    return;
  }
  await pool.query('UPDATE trips SET status = ? WHERE id = ?', ['LOADING', tripId]);
  PASS('Trip: PLANNED → LOADING');

  // Handoff: Order → ON_TRUCK
  if (!await updateOrderStatus(orderId, 'RECEIVED_WH_TH', 'ON_TRUCK')) return;

  // Trip: LOADING → DEPARTED
  await pool.query('UPDATE trips SET status = ? WHERE id = ?', ['DEPARTED', tripId]);
  PASS('Trip: LOADING → DEPARTED');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Cross Border
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── STEP 4: Cross Border ──────────────────────');
  if (!await updateOrderStatus(orderId, 'ON_TRUCK', 'CROSSING_BORDER')) return;

  // Trip: DEPARTED → AT_BORDER
  await pool.query('UPDATE trips SET status = ? WHERE id = ?', ['AT_BORDER', tripId]);
  PASS('Trip: DEPARTED → AT_BORDER');

  // No customs hold for this test — skip to ARRIVED_BORDER_WH
  if (!await updateOrderStatus(orderId, 'CROSSING_BORDER', 'ARRIVED_BORDER_WH')) return;

  // Trip: AT_BORDER → CROSSED → ARRIVED
  await pool.query('UPDATE trips SET status = ? WHERE id = ?', ['CROSSED', tripId]);
  PASS('Trip: AT_BORDER → CROSSED');
  await pool.query('UPDATE trips SET status = ? WHERE id = ?', ['ARRIVED', tripId]);
  PASS('Trip: CROSSED → ARRIVED');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Arrive at Destination Warehouse
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── STEP 5: Arrive Destination Warehouse ──────');
  if (!await updateOrderStatus(orderId, 'ARRIVED_BORDER_WH', 'AT_DEST_WH')) return;

  // Trip: ARRIVED → UNLOADING → COMPLETED
  await pool.query('UPDATE trips SET status = ? WHERE id = ?', ['UNLOADING', tripId]);
  PASS('Trip: ARRIVED → UNLOADING');
  await pool.query('UPDATE trips SET status = ? WHERE id = ?', ['COMPLETED', tripId]);
  PASS('Trip: UNLOADING → COMPLETED ✓ Trip pipeline complete');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Delivery
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── STEP 6: Out for Delivery ──────────────────');
  if (!await updateOrderStatus(orderId, 'AT_DEST_WH', 'OUT_FOR_DELIVERY')) return;

  console.log('\n── STEP 7: Mark Delivered ────────────────────');
  if (!await updateOrderStatus(orderId, 'OUT_FOR_DELIVERY', 'DELIVERED')) return;

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 8: COD Settlement (since cod_amount=500)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── STEP 8: COD Collection + Remittance ───────');
  
  // Ensure cod_settlements row exists
  await pool.query(
    `INSERT INTO cod_settlements (order_id, cod_amount, status)
     VALUES (?, 500, 'PENDING')
     ON DUPLICATE KEY UPDATE cod_amount = 500`,
    [orderId]
  );
  PASS('COD settlement row ensured (PENDING)');

  // COD Collect
  if (!await updateOrderStatus(orderId, 'DELIVERED', 'COD_COLLECTED')) return;
  await pool.query(
    `UPDATE cod_settlements SET status = 'COLLECTED', collected_at = NOW() WHERE order_id = ?`,
    [orderId]
  );
  PASS('COD marked COLLECTED');

  // COD Remit
  if (!await updateOrderStatus(orderId, 'COD_COLLECTED', 'COD_REMITTED')) return;
  await pool.query(
    `UPDATE cod_settlements SET status = 'REMITTED', remitted_at = NOW(), remitted_to = 'ผู้ส่งทดสอบ' WHERE order_id = ?`,
    [orderId]
  );
  PASS('COD marked REMITTED');

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 9: Close Order
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── STEP 9: Close Order ──────────────────────');
  if (!await updateOrderStatus(orderId, 'COD_REMITTED', 'CLOSED')) return;

  // ═══════════════════════════════════════════════════════════════════════════
  // VERIFY: Check final state
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── VERIFICATION ─────────────────────────────');
  
  const [[finalOrder]] = await pool.query('SELECT status, cod_amount FROM orders WHERE id = ?', [orderId]);
  const [[finalTrip]] = await pool.query('SELECT status FROM trips WHERE id = ?', [tripId]);
  const [[finalCod]] = await pool.query('SELECT status FROM cod_settlements WHERE order_id = ?', [orderId]);
  const [logCount] = await pool.query('SELECT COUNT(*) AS cnt FROM order_status_logs WHERE order_id = ?', [orderId]);

  if (finalOrder.status === 'CLOSED') PASS(`Order final status: CLOSED ✓`);
  else FAIL(`Order status should be CLOSED, got: ${finalOrder.status}`);

  if (finalTrip.status === 'COMPLETED') PASS(`Trip final status: COMPLETED ✓`);
  else FAIL(`Trip status should be COMPLETED, got: ${finalTrip.status}`);

  if (finalCod.status === 'REMITTED') PASS(`COD final status: REMITTED ✓`);
  else FAIL(`COD status should be REMITTED, got: ${finalCod.status}`);

  INFO(`Total status log entries: ${logCount[0].cnt}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // Verify tracking page can find this order
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── TRACKING PAGE CHECK ──────────────────────');
  const [[trackCheck]] = await pool.query(
    `SELECT o.job_no, o.status, s.name AS sender_name, r.name AS receiver_name
     FROM orders o
     LEFT JOIN customers s ON s.id = o.sender_id
     LEFT JOIN customers r ON r.id = o.receiver_id
     WHERE o.job_no = ?`,
    [jobNo]
  );
  if (trackCheck) PASS(`Tracking query works: ${trackCheck.job_no} (${trackCheck.sender_name} → ${trackCheck.receiver_name})`);
  else FAIL('Tracking query returned no results');

  // ═══════════════════════════════════════════════════════════════════════════
  // BONUS: Test invalid transition is blocked
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── NEGATIVE TEST: Invalid Transitions ───────');
  const blocked1 = canTransitionOrder('CLOSED', 'NEW');
  const blocked2 = canTransitionOrder('DELIVERED', 'NEW');
  const blocked3 = canTransitionOrder('NEW', 'DELIVERED');
  
  if (!blocked1) PASS('CLOSED → NEW blocked ✓');
  else FAIL('CLOSED → NEW should be blocked!');
  
  if (!blocked2) PASS('DELIVERED → NEW blocked ✓');
  else FAIL('DELIVERED → NEW should be blocked!');
  
  if (!blocked3) PASS('NEW → DELIVERED blocked ✓');
  else FAIL('NEW → DELIVERED should be blocked!');

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║    🎉  E2E PIPELINE TEST COMPLETE            ║');
  console.log(`║    Order: ${jobNo.padEnd(30)}   ║`);
  console.log(`║    Trip:  ${tripNo.padEnd(30)}   ║`);
  console.log('╚══════════════════════════════════════════════╝\n');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
}).finally(() => process.exit());
