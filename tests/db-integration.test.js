import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/config/db.js';
import { transitionOrder } from '../src/services/orderWorkflowService.js';
import { CRM_ROLES, OPERATIONAL_ROLES } from '../src/middleware/auth.js';
import { CUSTOMER_NOTIFICATION_STATUSES } from '../src/services/notificationService.js';
import { findAccountByPhone, findSoleCustomerMatch } from '../src/services/memberLinkService.js';

test('database accepts every application role', async () => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    for (const [index, role] of [...OPERATIONAL_ROLES, ...CRM_ROLES].entries()) {
      await conn.query(
        `INSERT INTO users (username,password_hash,role,name,status)
         VALUES (?, 'test-only', ?, ?, 'active')`,
        [`__role_test_${Date.now()}_${index}`, role, `Role test ${role}`]
      );
    }
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('scanner transition and notification outbox commit atomically', async () => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    let [[user]] = await conn.query('SELECT id FROM users ORDER BY id LIMIT 1');
    if (!user) {
      const [createdUser] = await conn.query(
        `INSERT INTO users (username,password_hash,role,name,status)
         VALUES (?, 'test-only', 'admin', 'Database integration test', 'active')`,
        [`__db_integration_${Date.now()}`]
      );
      user = { id: createdUser.insertId };
    }
    const [sender] = await conn.query(
      `INSERT INTO customers (name,phone,address) VALUES ('Scanner Sender','0810000001','Test')`
    );
    const [receiver] = await conn.query(
      `INSERT INTO customers (name,phone,address) VALUES ('Scanner Receiver','0205550001','Test')`
    );
    const jobNo = `TEST-SCAN-${Date.now()}`;
    const [created] = await conn.query(
      `INSERT INTO orders
       (job_no,direction,sender_id,receiver_id,status,price_amount,cod_amount,requires_customs,screening_status)
       VALUES (?, 'TH_TO_LA', ?, ?, 'NEW', 100, 0, 0, 'PASSED')`,
      [jobNo, sender.insertId, receiver.insertId]
    );

    const chain = [
      ['RECEIVED_WH_TH', 'SCANNER_RECEIVE'],
      ['ON_TRUCK', 'SCANNER_HANDOFF'],
      ['CROSSING_BORDER', 'SCANNER_AUTO'],
      ['ARRIVED_BORDER_WH', 'SCANNER_AUTO'],
      ['AT_DEST_WH', 'SCANNER_UNLOAD'],
      ['OUT_FOR_DELIVERY', 'SCANNER_AUTO'],
      ['DELIVERED', 'SCANNER_AUTO'],
    ];
    for (const [status, source] of chain) {
      await transitionOrder({
        orderId: created.insertId,
        toStatus: status,
        userId: user.id,
        note: `Integration ${source}`,
        source,
        connection: conn,
      });
    }

    const [[state]] = await conn.query('SELECT status, delivered_at FROM orders WHERE id=?', [created.insertId]);
    assert.equal(state.status, 'DELIVERED');
    assert.ok(state.delivered_at);
    const [[queued]] = await conn.query(
      `SELECT COUNT(*) count FROM customer_notification_outbox WHERE order_id=?`,
      [created.insertId]
    );
    // Customer WhatsApp is intentionally limited to two touch-points (see
    // notificationService.js), not one notification per status in the chain.
    const expectedNotifications = chain.filter(([status]) => CUSTOMER_NOTIFICATION_STATUSES.has(status)).length;
    assert.equal(Number(queued.count), expectedNotifications);
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('referral reward grants exactly once per referred member, driven through caller-owned transitions', async () => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

    let [[user]] = await conn.query('SELECT id FROM users ORDER BY id LIMIT 1');
    if (!user) {
      const [createdUser] = await conn.query(
        `INSERT INTO users (username,password_hash,role,name,status)
         VALUES (?, 'test-only', 'admin', 'Referral integration test', 'active')`,
        [`__ref_integration_${suffix}`]
      );
      user = { id: createdUser.insertId };
    }

    const [referrer] = await conn.query(
      `INSERT INTO customer_accounts
         (phone, phone_display, password_hash, first_name, last_name, referral_code, status)
       VALUES (?, ?, 'test-only', 'Referrer', 'One', ?, 'active')`,
      [`856${suffix.slice(-9)}`, `020 ${suffix.slice(-9)}`, `REF-${suffix}`]
    );

    const [customer] = await conn.query(
      `INSERT INTO customers (name, phone, phone_normalized, address, active)
       VALUES (?, ?, ?, 'Referral integration test', 1)`,
      [`Referred customer ${suffix}`, `856${suffix.slice(-9)}`, `856${suffix.slice(-9)}`]
    );

    const [referred] = await conn.query(
      `INSERT INTO customer_accounts
         (phone, phone_display, password_hash, first_name, last_name, referral_code,
          referred_by_account_id, legacy_customer_id, status)
       VALUES (?, ?, 'test-only', 'Referred', 'One', ?, ?, ?, 'active')`,
      [`669${suffix.slice(-9)}`, `08${suffix.slice(-8)}`, `RFD-${suffix}`, referrer.insertId, customer.insertId]
    );

    // Drive a fresh order to DELIVERED using a CALLER-OWNED connection — the
    // majority-case shape in production (branch delivery, rider self-delivery,
    // office self-pickup all pass their own connection, so ownsTransaction is
    // false). This is the real proof the pre-commit hook fires on that path.
    const driveToDelivered = async (tag) => {
      const jobNo = `TEST-REF-${tag}-${Date.now()}`;
      const [created] = await conn.query(
        `INSERT INTO orders
         (job_no,direction,sender_id,receiver_id,status,price_amount,cod_amount,requires_customs,screening_status)
         VALUES (?, 'TH_TO_LA', ?, ?, 'NEW', 100, 0, 0, 'PASSED')`,
        [jobNo, customer.insertId, customer.insertId]
      );
      for (const [status, source] of [
        ['RECEIVED_WH_TH', 'SCANNER_RECEIVE'],
        ['ON_TRUCK', 'SCANNER_HANDOFF'],
        ['CROSSING_BORDER', 'SCANNER_AUTO'],
        ['ARRIVED_BORDER_WH', 'SCANNER_AUTO'],
        ['AT_DEST_WH', 'SCANNER_UNLOAD'],
        ['OUT_FOR_DELIVERY', 'SCANNER_AUTO'],
        ['DELIVERED', 'SCANNER_AUTO'],
      ]) {
        await transitionOrder({
          orderId: created.insertId,
          toStatus: status,
          userId: user.id,
          note: `Referral ${source}`,
          source,
          connection: conn,
        });
      }
      return created.insertId;
    };

    const firstOrderId = await driveToDelivered('FIRST');

    // Exactly two rows — one per side of the pair, both linked to the first order.
    const [[grantCount]] = await conn.query(
      `SELECT COUNT(*) count FROM referral_reward_events WHERE referred_account_id = ?`,
      [referred.insertId]
    );
    assert.equal(Number(grantCount.count), 2);

    const [grantRows] = await conn.query(
      `SELECT role, beneficiary_account_id, triggering_order_id, status
       FROM referral_reward_events WHERE referred_account_id = ?`,
      [referred.insertId]
    );
    assert.deepEqual(
      grantRows.map(r => [r.role, r.status]).sort(),
      [['referred', 'granted'], ['referrer', 'granted']]
    );
    assert.ok(grantRows.every(r => Number(r.triggering_order_id) === firstOrderId));

    // Both WhatsApp messages were enqueued in the same transaction.
    const [[referralNotifs]] = await conn.query(
      `SELECT COUNT(*) count FROM customer_notification_outbox
       WHERE order_id = ? AND referral_reward_id IS NOT NULL`,
      [firstOrderId]
    );
    assert.equal(Number(referralNotifs.count), 2);

    // A second delivery by the same referred member must NOT grant again —
    // uq_rre_referred_once is the real idempotency guarantee, caught as
    // ER_DUP_ENTRY, so no duplicate rows and no duplicate messages.
    const secondOrderId = await driveToDelivered('SECOND');

    const [[grantCountAfter]] = await conn.query(
      `SELECT COUNT(*) count FROM referral_reward_events WHERE referred_account_id = ?`,
      [referred.insertId]
    );
    assert.equal(Number(grantCountAfter.count), 2);

    const [[secondNotifs]] = await conn.query(
      `SELECT COUNT(*) count FROM customer_notification_outbox
       WHERE order_id = ? AND referral_reward_id IS NOT NULL`,
      [secondOrderId]
    );
    assert.equal(Number(secondNotifs.count), 0);
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test('member linkage lookups are backed by the legacy-customer FK and reject ambiguous phones', async () => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const phone = `669${suffix.slice(-8)}`;
    const [customer] = await conn.query(
      `INSERT INTO customers (name, phone, phone_normalized, address, active)
       VALUES (?, ?, ?, 'Database integration test', 1)`,
      [`Member linkage ${suffix}`, phone, phone]
    );
    const [account] = await conn.query(
      `INSERT INTO customer_accounts
         (phone, phone_display, password_hash, first_name, last_name, referral_code, status)
       VALUES (?, ?, 'test-only', 'Member', 'Linkage', ?, 'active')`,
      [phone, phone, `DBL-${suffix}`]
    );

    assert.equal(await findSoleCustomerMatch(phone, conn), customer.insertId);
    const matchedAccount = await findAccountByPhone(phone, conn);
    assert.equal(matchedAccount?.id, account.insertId);
    assert.equal(matchedAccount?.legacy_customer_id, null);

    const [[foreignKey]] = await conn.query(
      `SELECT COUNT(*) AS count
       FROM information_schema.table_constraints
       WHERE constraint_schema = DATABASE()
         AND table_name = 'customer_accounts'
         AND constraint_name = 'fk_ca_legacy_customer'
         AND constraint_type = 'FOREIGN KEY'`
    );
    assert.equal(Number(foreignKey.count), 1);

    await conn.query(
      `INSERT INTO customers (name, phone, phone_normalized, address, active)
       VALUES (?, ?, ?, 'Ambiguous database integration test', 1)`,
      [`Member linkage duplicate ${suffix}`, phone, phone]
    );
    assert.equal(await findSoleCustomerMatch(phone, conn), null);
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test.after(async () => {
  await pool.end();
});
