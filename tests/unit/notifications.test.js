import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_NOTIFICATION_STATUSES,
  enqueueOrderNotification,
  requeueFailedNotifications,
} from '../../src/services/notificationService.js';

test('customers are notified at exactly two touch-points (on-truck + arrived)', () => {
  // Only these two statuses notify the customer — no per-step spam.
  for (const status of ['ON_TRUCK', 'AT_DEST_WH']) {
    assert.equal(CUSTOMER_NOTIFICATION_STATUSES.has(status), true, status);
  }
  // Everything else must stay silent for the customer.
  for (const status of [
    'RECEIVED_WH_TH', 'RECEIVED_WH_LA', 'CROSSING_BORDER', 'ARRIVED_BORDER_WH',
    'BRANCH_TRANSFER', 'BRANCH_RECEIVED', 'RIDER_ASSIGNED', 'OUT_FOR_DELIVERY',
    'DELIVERED', 'DELIVERY_FAILED', 'RETURN_TO_SENDER',
    'SCREENING_CUSTOMS_REQUIRED', 'SCREENING_REJECTED',
  ]) {
    assert.equal(CUSTOMER_NOTIFICATION_STATUSES.has(status), false, status);
  }
  assert.equal(CUSTOMER_NOTIFICATION_STATUSES.size, 2);
});

test('enqueue uses an idempotent event key and persists source metadata', async () => {
  const calls = [];
  const conn = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [{ insertId: 42 }];
    },
  };
  const id = await enqueueOrderNotification(conn, {
    orderId: 7,
    status: 'AT_DEST_WH',
    eventKey: 'ORDER_STATUS_LOG:99',
    source: 'SCANNER_UNLOAD',
  });
  assert.equal(id, 42);
  assert.match(calls[0].sql, /customer_notification_outbox/);
  assert.equal(calls[0].params[0], 'ORDER_STATUS_LOG:99');
  assert.match(calls[0].params[3], /SCANNER_UNLOAD/);
});

test('non-customer-facing status does not create an outbox row', async () => {
  const conn = { query: async () => assert.fail('query should not be called') };
  assert.equal(await enqueueOrderNotification(conn, {
    orderId: 1,
    status: 'CUSTOMS_HOLD',
    eventKey: 'x',
}), null);
});

test('manual WhatsApp restart can requeue exhausted notification jobs', async () => {
  const calls = [];
  const conn = {
    async query(sql) {
      calls.push(sql);
      return [{ affectedRows: 3 }];
    },
  };
  assert.equal(await requeueFailedNotifications(conn), 3);
  assert.match(calls[0], /status='FAILED'/);
  assert.match(calls[0], /attempts=0/);
});
