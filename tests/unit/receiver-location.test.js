import test from 'node:test';
import assert from 'node:assert/strict';
import {
  saveCustomerLocation,
  applySavedLocationToOrder,
} from '../../src/services/receiverLocationService.js';

/** Fake connection recording every statement, with scripted results per call. */
function fakeConn(results = []) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const next = results[i++];
      return next === undefined ? [{ affectedRows: 0 }] : next;
    },
  };
}

test('a pin is stored on the customer and copied onto their in-flight parcels', async () => {
  const conn = fakeConn([
    [[{ id: 5, location_source: null }]], // customer lookup
    [{ affectedRows: 1 }],                // customers UPDATE
    [{ affectedRows: 2 }],                // orders UPDATE
  ]);

  const result = await saveCustomerLocation(5, 17.9757, 102.6331, 'WHATSAPP_PIN', conn);

  assert.deepEqual(result, { saved: true, ordersUpdated: 2 });
  assert.match(conn.calls[1].sql, /UPDATE customers/);
  assert.deepEqual(conn.calls[1].params, [17.9757, 102.6331, 'WHATSAPP_PIN', 5]);
  // Delivered/closed parcels are history — a late pin must not rewrite where
  // a parcel actually went.
  assert.match(conn.calls[2].sql, /UPDATE orders/);
  assert.doesNotMatch(conn.calls[2].sql, /DELIVERED|CLOSED|COD_/);
  assert.ok(conn.calls[2].params.includes('OUT_FOR_DELIVERY'));
});

test("a rider's doorstep reading is not downgraded by a later WhatsApp pin", async () => {
  const conn = fakeConn([[[{ id: 5, location_source: 'RIDER_DELIVERY' }]]]);

  const result = await saveCustomerLocation(5, 17.9, 102.6, 'WHATSAPP_PIN', conn);

  assert.equal(result.saved, false);
  assert.equal(result.reason, 'KEPT_MORE_PRECISE');
  assert.equal(conn.calls.length, 1, 'must not write anything');
});

test('a rider reading replaces an earlier WhatsApp pin, and staff may correct either', async () => {
  for (const [existing, incoming] of [
    ['WHATSAPP_PIN', 'RIDER_DELIVERY'],
    ['WHATSAPP_PIN', 'WHATSAPP_PIN'],
    ['RIDER_DELIVERY', 'STAFF'],
    ['RIDER_DELIVERY', 'RIDER_DELIVERY'],
  ]) {
    const conn = fakeConn([
      [[{ id: 5, location_source: existing }]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 0 }],
    ]);
    const result = await saveCustomerLocation(5, 17.9, 102.6, incoming, conn);
    assert.equal(result.saved, true, `${existing} → ${incoming}`);
  }
});

test('coordinates that cannot be a real address are rejected before any write', async () => {
  for (const [lat, lng, why] of [
    [0, 0, 'null island — what a device reports with no fix'],
    [null, 102.6, 'missing latitude'],
    [17.9, undefined, 'missing longitude'],
    [91, 102.6, 'latitude out of range'],
    [17.9, 181, 'longitude out of range'],
    ['ບ້ານ', 102.6, 'not a number'],
  ]) {
    const conn = fakeConn();
    const result = await saveCustomerLocation(5, lat, lng, 'WHATSAPP_PIN', conn);
    assert.equal(result.saved, false, why);
    assert.equal(result.reason, 'BAD_COORDINATE', why);
    assert.equal(conn.calls.length, 0, `${why} — must not touch the database`);
  }
});

test('a new order inherits the pin captured on an earlier parcel', async () => {
  const conn = fakeConn([
    [[{ lat: 17.9757, lng: 102.6331 }]],
    [{ affectedRows: 1 }],
  ]);

  const result = await applySavedLocationToOrder(88, 5, conn);

  assert.equal(result.applied, true);
  assert.match(conn.calls[1].sql, /UPDATE orders SET receiver_lat/);
  assert.deepEqual(conn.calls[1].params, [17.9757, 102.6331, 88]);
});

test('an order for a customer with no pin yet is left alone', async () => {
  // Never pinned at all.
  const noPin = fakeConn([[[{ lat: null, lng: null }]]]);
  assert.deepEqual(await applySavedLocationToOrder(88, 5, noPin), { applied: false });
  assert.equal(noPin.calls.length, 1, 'must not write an empty location');

  // No receiver on the order (an order can be created before the receiver is set).
  const noReceiver = fakeConn();
  assert.deepEqual(await applySavedLocationToOrder(88, null, noReceiver), { applied: false });
  assert.equal(noReceiver.calls.length, 0);
});
