/**
 * receiverLocationService.js — where the receiver actually is.
 *
 * orders.receiver_lat/receiver_lng drive three things: the map in the rider's
 * job screen, findNearestBranch (automatic branch routing), and the distance
 * that decides the delivery zone and its fee. Nothing ever wrote them, so all
 * three silently degraded — no branch was ever matched automatically, and every
 * order fell through to zone 'X' at a zero fee.
 *
 * Two sources fill the gap, both reusing something the business already does:
 *
 *   WHATSAPP_PIN    the customer taps 📎 → Location in the WhatsApp thread they
 *                   already have with SNG. No app, no link, works on any phone.
 *   RIDER_DELIVERY  the rider's GPS at a successful delivery — already captured
 *                   as proof of delivery and otherwise thrown away.
 *
 * The pin lives on the customer so it carries forward to their next parcel, and
 * is copied onto open orders so deliveries already in flight benefit right away.
 */
import pool from '../config/db.js';
import { toWaPhone } from '../utils/waPhone.js';

/**
 * Statuses where a pin can still change the outcome of a delivery. Once a
 * parcel is DELIVERED or CLOSED its coordinates are history — overwriting them
 * would rewrite the record of where it actually went.
 */
const OPEN_FOR_LOCATION = [
  'AT_DEST_WH', 'BRANCH_TRANSFER', 'BRANCH_RECEIVED',
  'RIDER_ASSIGNED', 'RIDER_ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED',
];

/**
 * A rider standing at the door is a better reading than a pin dropped from the
 * sofa, so a WhatsApp pin never overwrites one. Anything else is fair game:
 * a fresh pin beats an older pin, and staff may always correct either.
 */
function mayOverwrite(existingSource, incomingSource) {
  if (!existingSource) return true;
  if (incomingSource === 'STAFF') return true;
  if (existingSource === 'RIDER_DELIVERY' && incomingSource === 'WHATSAPP_PIN') return false;
  return true;
}

function isUsableCoordinate(lat, lng) {
  // Reject the empty values before Number() sees them: Number(null) and
  // Number('') are both 0, which would otherwise sail through as a latitude
  // of zero and pin the customer off the coast of Africa.
  for (const value of [lat, lng]) {
    if (value === null || value === undefined || value === '') return false;
  }
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return false;
  // Null Island — what a device reports when it has no fix at all.
  return !(a === 0 && b === 0);
}

/**
 * Store a location against a customer and copy it onto their in-flight orders.
 *
 * @param {number} customerId
 * @param {number} lat
 * @param {number} lng
 * @param {'WHATSAPP_PIN'|'RIDER_DELIVERY'|'STAFF'} source
 * @param {object} [conn] existing connection/transaction to run inside
 * @returns {Promise<{saved:boolean, reason?:string, ordersUpdated?:number}>}
 */
export async function saveCustomerLocation(customerId, lat, lng, source, conn = pool) {
  if (!customerId) return { saved: false, reason: 'NO_CUSTOMER' };
  if (!isUsableCoordinate(lat, lng)) return { saved: false, reason: 'BAD_COORDINATE' };

  const [[customer]] = await conn.query(
    'SELECT id, location_source FROM customers WHERE id=?', [customerId]
  );
  if (!customer) return { saved: false, reason: 'NO_CUSTOMER' };
  if (!mayOverwrite(customer.location_source, source)) {
    return { saved: false, reason: 'KEPT_MORE_PRECISE' };
  }

  await conn.query(
    `UPDATE customers
        SET lat=?, lng=?, location_source=?, location_updated_at=NOW()
      WHERE id=?`,
    [lat, lng, source, customerId]
  );

  // Orders already on their way get the pin too — waiting for the next parcel
  // would waste it on exactly the delivery the customer sent it for.
  const [res] = await conn.query(
    `UPDATE orders
        SET receiver_lat=?, receiver_lng=?
      WHERE receiver_id=?
        AND status IN (${OPEN_FOR_LOCATION.map(() => '?').join(',')})`,
    [lat, lng, customerId, ...OPEN_FOR_LOCATION]
  );

  return { saved: true, ordersUpdated: res.affectedRows };
}

/**
 * Handle a location pin arriving over WhatsApp from an unknown sender: match
 * the phone to a customer, then store it. Matching goes through toWaPhone so a
 * pin from "02012345678" lands on the customer saved as "+856 20 123 456 78".
 *
 * @returns {Promise<{saved:boolean, reason?:string, customerId?:number, ordersUpdated?:number}>}
 */
export async function saveLocationFromPhone(phoneRaw, lat, lng, source = 'WHATSAPP_PIN') {
  const phone = toWaPhone(phoneRaw);
  if (!phone) return { saved: false, reason: 'BAD_PHONE' };

  // Prefer a customer with a parcel in flight — a number shared by several
  // customer rows (a shop and its owner, say) should pin the one expecting
  // something, not whichever row was created first.
  const [[match]] = await pool.query(
    `SELECT c.id
       FROM customers c
       LEFT JOIN orders o
         ON o.receiver_id = c.id
        AND o.status IN (${OPEN_FOR_LOCATION.map(() => '?').join(',')})
      WHERE c.phone_normalized = ? OR c.phone = ?
      ORDER BY (o.id IS NOT NULL) DESC, o.created_at DESC, c.id ASC
      LIMIT 1`,
    [...OPEN_FOR_LOCATION, phone, phoneRaw]
  );
  if (!match) return { saved: false, reason: 'NO_CUSTOMER_FOR_PHONE' };

  const result = await saveCustomerLocation(match.id, lat, lng, source);
  return { ...result, customerId: match.id };
}

/**
 * Remember where a delivery actually happened, so the next parcel for the same
 * receiver is pinned without anyone being asked. Called after the rider's
 * delivery transition has committed; failures here must never fail a delivery
 * that already physically happened, so everything is caught and logged.
 */
export async function rememberDeliveryLocation(orderId, lat, lng) {
  try {
    if (!isUsableCoordinate(lat, lng)) return { saved: false, reason: 'BAD_COORDINATE' };
    const [[order]] = await pool.query('SELECT receiver_id FROM orders WHERE id=?', [orderId]);
    if (!order?.receiver_id) return { saved: false, reason: 'NO_RECEIVER' };
    return await saveCustomerLocation(order.receiver_id, lat, lng, 'RIDER_DELIVERY');
  } catch (e) {
    console.error(`[ReceiverLocation] remember delivery order=${orderId} failed:`, e.message);
    return { saved: false, reason: 'ERROR' };
  }
}

/**
 * Copy a receiver's saved pin onto a newly created order. Called at order
 * creation so a returning customer's parcel is routable from the moment it
 * exists, rather than waiting for them to send the same pin again.
 */
export async function applySavedLocationToOrder(orderId, receiverId, conn = pool) {
  if (!receiverId) return { applied: false };
  const [[customer]] = await conn.query(
    'SELECT lat, lng FROM customers WHERE id=?', [receiverId]
  );
  if (!customer || !isUsableCoordinate(customer.lat, customer.lng)) return { applied: false };
  await conn.query(
    'UPDATE orders SET receiver_lat=?, receiver_lng=? WHERE id=?',
    [customer.lat, customer.lng, orderId]
  );
  return { applied: true, lat: customer.lat, lng: customer.lng };
}
