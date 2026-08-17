import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_NOTIFICATION_STATUSES,
  enqueueOrderNotification,
  requeueFailedNotifications,
  enqueuePurchaseAgentNotification,
} from '../../src/services/notificationService.js';
import { buildPurchaseAgentMessage } from '../../src/services/purchaseAgentNotificationService.js';

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

test('purchase-agent enqueue resolves recipient + payload from the quotation at enqueue time', async () => {
  const calls = [];
  let callCount = 0;
  const conn = {
    async query(sql, params) {
      callCount += 1;
      calls.push({ sql, params });
      if (callCount === 1) {
        // First call: the quotation/request/customer lookup.
        return [[{
          quote_no: 'PQ-20260817-0001', product_name: 'หูฟังบลูทูธ', desired_qty: 2,
          total_lak: 220000, deposit_required_lak: 150000,
          sng_shipping_lak: 15000, service_fee_lak: 20000,
          phone: '8562098765432', phone_display: '020 9876 5432',
        }]];
      }
      // Second call: the INSERT into customer_notification_outbox.
      return [{ insertId: 501 }];
    },
  };

  const id = await enqueuePurchaseAgentNotification(conn, {
    quotationId: 12,
    eventType: 'PURCHASE_AGENT:QUOTED',
    eventKey: 'PURCHASE_AGENT:PQ-20260817-0001:sent:77',
  });

  assert.equal(id, 501);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /partner_quotations/);
  assert.match(calls[1].sql, /customer_notification_outbox/);
  assert.match(calls[1].sql, /quotation_id/);
  const insertParams = calls[1].params;
  assert.equal(insertParams[0], 'PURCHASE_AGENT:PQ-20260817-0001:sent:77');
  assert.equal(insertParams[2], 12); // quotation_id
  assert.equal(insertParams[3], 'PURCHASE_AGENT:QUOTED');
  assert.equal(insertParams[4], '8562098765432'); // recipient
  const payload = JSON.parse(insertParams[5]);
  assert.equal(payload.quoteNo, 'PQ-20260817-0001');
  assert.equal(payload.totalLak, 220000);
});

test('purchase-agent enqueue skips silently when the resolved row has no phone', async () => {
  const conn = {
    async query() {
      return [[{ quote_no: 'PQ-X', product_name: 'x', phone: null, phone_display: null }]];
    },
  };
  assert.equal(await enqueuePurchaseAgentNotification(conn, {
    quotationId: 1, eventType: 'PURCHASE_AGENT:QUOTED', eventKey: 'k',
  }), null);
});

test('purchase-agent enqueue requires a quotation or request id before touching the DB', async () => {
  const conn = { query: async () => assert.fail('query should not be called') };
  assert.equal(await enqueuePurchaseAgentNotification(conn, {
    eventType: 'PURCHASE_AGENT:QUOTED', eventKey: 'k',
  }), null);
});

test('every enqueueable purchase-agent stage has a Lao WhatsApp template', () => {
  const stages = [
    'REQUEST_RECEIVED', 'DECLINED', 'QUOTED', 'ACCEPTED', 'REJECTED',
    'DEPOSIT_RECORDED', 'PURCHASING', 'PURCHASED', 'BRIDGED',
  ];
  const payload = {
    productName: 'ทดสอบ', qty: 1, reason: 'ทดสอบ',
    quoteNo: 'PQ-1', productLak: 1000, serviceFeeLak: 1000, sngShippingLak: 1000,
    totalLak: 3000, depositLak: 1000, paidLak: 1000, jobNo: 'JOB-1',
  };
  for (const stage of stages) {
    const text = buildPurchaseAgentMessage(`PURCHASE_AGENT:${stage}`, payload);
    assert.equal(typeof text, 'string', `${stage} should render a message`);
    assert.ok(text.length > 0, `${stage} message should not be empty`);
  }
  // Unknown event types must not crash the dispatcher — just skip.
  assert.equal(buildPurchaseAgentMessage('PURCHASE_AGENT:NOT_A_REAL_STAGE', payload), null);
});
