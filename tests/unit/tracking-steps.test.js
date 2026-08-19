import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import {
  stepIcon,
  stepTone,
  buildTrackingTimeline,
} from '../../src/constants/trackingSteps.js';
import { ORDER_STATUS_LABELS } from '../../src/constants/statuses.js';

test('the newest event leads, and only it is marked current', () => {
  const logs = [
    { to_status: 'NEW',            action_at: '2026-08-18T10:00:00Z' },
    { to_status: 'RECEIVED_WH_TH', action_at: '2026-08-18T12:00:00Z' },
    { to_status: 'ON_TRUCK',       action_at: '2026-08-19T08:00:00Z' },
  ];
  const timeline = buildTrackingTimeline(logs, { status: 'ON_TRUCK' });

  assert.deepEqual(timeline.map(s => s.status), ['ON_TRUCK', 'RECEIVED_WH_TH', 'NEW']);
  assert.equal(timeline[0].current, true);
  assert.equal(timeline.filter(s => s.current).length, 1);
});

test('an order with no history yet still shows where it stands', () => {
  // A parcel created seconds ago has no log rows; an empty timeline would read
  // as "we have no idea where your parcel is".
  const timeline = buildTrackingTimeline([], { status: 'NEW', created_at: '2026-08-18T10:00:00Z' });

  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].status, 'NEW');
  assert.equal(timeline[0].at, '2026-08-18T10:00:00Z');
  assert.equal(timeline[0].current, true);
});

test('building a timeline does not disturb the caller’s log array', () => {
  // The controller passes the same rows to the view as `logs`; reversing in
  // place would silently flip that copy too.
  const logs = [
    { to_status: 'NEW',      action_at: '2026-08-18T10:00:00Z' },
    { to_status: 'ON_TRUCK', action_at: '2026-08-19T08:00:00Z' },
  ];
  buildTrackingTimeline(logs, { status: 'ON_TRUCK' });

  assert.deepEqual(logs.map(l => l.to_status), ['NEW', 'ON_TRUCK']);
});

test('failures read as alerts, deliveries as success, the rest as neutral', () => {
  for (const status of ['DELIVERY_FAILED', 'CUSTOMS_REJECTED', 'RETURN_TO_SENDER', 'CANCELLED']) {
    assert.equal(stepTone(status), 'problem', status);
  }
  for (const status of ['DELIVERED', 'COD_COLLECTED', 'CLOSED']) {
    assert.equal(stepTone(status), 'success', status);
  }
  for (const status of ['ON_TRUCK', 'AT_DEST_WH', 'OUT_FOR_DELIVERY']) {
    assert.equal(stepTone(status), 'normal', status);
  }
});

test('every status the app can reach has its own icon', () => {
  // A status with no icon falls back to a generic dot — fine as a safety net,
  // but a status we actually ship should never rely on it.
  for (const status of Object.keys(ORDER_STATUS_LABELS)) {
    assert.notEqual(stepIcon(status), 'fa-solid fa-circle-dot', `${status} has no icon`);
  }
});

test('an unknown status still renders rather than breaking the page', () => {
  assert.equal(stepIcon('SOMETHING_NEW'), 'fa-solid fa-circle-dot');
  assert.equal(stepTone('SOMETHING_NEW'), 'normal');
});

test('every status has customer-facing wording in both Thai and Lao', () => {
  const th = JSON.parse(readFileSync(new URL('../../src/i18n/th.json', import.meta.url)));
  const lo = JSON.parse(readFileSync(new URL('../../src/i18n/lo.json', import.meta.url)));

  for (const status of Object.keys(ORDER_STATUS_LABELS)) {
    assert.ok(th.trackStep?.[status], `th.trackStep.${status} missing`);
    assert.ok(lo.trackStep?.[status], `lo.trackStep.${status} missing`);
  }
  // The two files must not drift apart as statuses are added.
  assert.deepEqual(Object.keys(th.trackStep).sort(), Object.keys(lo.trackStep).sort());
});

// ── Phase 3: the Thai leg on the customer's tracking page ────────────────────
import { buildSupplierTimeline, supplierStepIcon } from '../../src/constants/trackingSteps.js';

test('the Thai leg reads newest first, like the SNG leg below it', () => {
  const logs = [
    { to_status: 'accepted',         action_at: '2026-08-10T09:00:00Z' },
    { to_status: 'purchasing',       action_at: '2026-08-10T11:00:00Z' },
    { to_status: 'purchased',        action_at: '2026-08-11T10:00:00Z' },
    { to_status: 'supplier_shipped', action_at: '2026-08-12T14:00:00Z' },
  ];
  const timeline = buildSupplierTimeline(logs);

  assert.deepEqual(timeline.map(s => s.status),
    ['supplier_shipped', 'purchased', 'purchasing', 'accepted']);
  assert.equal(timeline[0].current, true);
  assert.equal(timeline.filter(s => s.current).length, 1);
});

test('quote negotiation and the bridge into the SNG leg are left out', () => {
  const logs = [
    { to_status: 'draft',     action_at: '2026-08-09T09:00:00Z' },
    { to_status: 'sent',      action_at: '2026-08-09T10:00:00Z' },
    { to_status: 'accepted',  action_at: '2026-08-10T09:00:00Z' },
    { to_status: 'at_th_hub', action_at: '2026-08-13T09:00:00Z' },
    // `ordered` is where the SNG timeline picks the story up; printing it here
    // as well reads as a stutter.
    { to_status: 'ordered',   action_at: '2026-08-13T10:00:00Z' },
  ];
  const shown = buildSupplierTimeline(logs).map(s => s.status);

  assert.deepEqual(shown, ['at_th_hub', 'accepted']);
  for (const hidden of ['draft', 'sent', 'ordered']) {
    assert.ok(!shown.includes(hidden), hidden);
  }
});

test('box counts ride only on the steps they explain, and only on split orders', () => {
  const logs = [
    { to_status: 'purchased',        action_at: '2026-08-11T10:00:00Z' },
    { to_status: 'supplier_shipped', action_at: '2026-08-12T14:00:00Z' },
  ];
  const split = buildSupplierTimeline(logs, { arrived: 1, expected: 3, shipped: 2 });
  const byStatus = Object.fromEntries(split.map(s => [s.status, s]));
  assert.ok(byStatus.supplier_shipped.counts, 'shipped step should carry counts');
  assert.equal(byStatus.purchased.counts, null, 'buying explains no box count');

  // "1 of 1 boxes" is noise on an order that never split.
  const single = buildSupplierTimeline(logs, { arrived: 1, expected: 1, shipped: 1 });
  assert.equal(single.find(s => s.status === 'supplier_shipped').counts, null);
});

test('a quotation with no history yet yields an empty leg rather than throwing', () => {
  assert.deepEqual(buildSupplierTimeline([]), []);
  assert.deepEqual(buildSupplierTimeline(null), []);
  assert.deepEqual(buildSupplierTimeline(undefined), []);
});

test('every customer-visible Thai-leg stage has its own icon and wording', () => {
  const th = JSON.parse(readFileSync(new URL('../../src/i18n/th.json', import.meta.url)));
  const lo = JSON.parse(readFileSync(new URL('../../src/i18n/lo.json', import.meta.url)));

  for (const status of ['accepted', 'purchasing', 'purchased', 'supplier_shipped', 'at_th_hub']) {
    assert.notEqual(supplierStepIcon(status), 'fa-solid fa-circle-dot', `${status} has no icon`);
    assert.ok(th.supplierStep?.[status], `th.supplierStep.${status} missing`);
    assert.ok(lo.supplierStep?.[status], `lo.supplierStep.${status} missing`);
    assert.ok(th.supplierStatus?.[status], `th.supplierStatus.${status} missing`);
    assert.ok(lo.supplierStatus?.[status], `lo.supplierStatus.${status} missing`);
  }
});
