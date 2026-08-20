/**
 * One-off backfill: apply a customer's already-saved location pin
 * (customers.lat/lng) onto any of their currently open-for-delivery orders
 * that are still missing receiver_lat/receiver_lng.
 *
 * Closes the gap fixed in orderWorkflowService.js's AT_DEST_WH hook, but
 * only going forward — an order that transitioned into AT_DEST_WH (or any
 * other OPEN_FOR_LOCATION status) *before* that fix shipped never got the
 * catch-up, even if the customer's pin was sitting on customers.lat/lng the
 * whole time. This finds those already-affected orders and applies it once.
 *
 * Safe to re-run: only orders with receiver_lat IS NULL are scanned, and
 * applySavedLocationToOrder is a no-op when the customer has no usable pin.
 */
import pool from '../src/config/db.js';
import { applySavedLocationToOrder, OPEN_FOR_LOCATION } from '../src/services/receiverLocationService.js';

async function main() {
  const placeholders = OPEN_FOR_LOCATION.map(() => '?').join(',');
  const [orders] = await pool.query(
    `SELECT id, receiver_id, job_no FROM orders
     WHERE status IN (${placeholders})
       AND receiver_id IS NOT NULL
       AND (receiver_lat IS NULL OR receiver_lng IS NULL)`,
    OPEN_FOR_LOCATION
  );

  let applied = 0;
  let noPin = 0;

  for (const order of orders) {
    const result = await applySavedLocationToOrder(order.id, order.receiver_id);
    if (result.applied) {
      applied++;
      console.log(`[Location Backfill] ${order.job_no}: applied (${result.lat}, ${result.lng})`);
    } else {
      noPin++;
    }
  }

  console.log(`[Location Backfill] Scanned ${orders.length} open order(s) missing coordinates`);
  console.log(`[Location Backfill] Applied ${applied}, no saved pin for ${noPin}`);
  await pool.end();
}

main().catch((error) => {
  console.error('[Location Backfill] Failed:', error.message);
  process.exitCode = 1;
});
