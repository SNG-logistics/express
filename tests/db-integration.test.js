import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/config/db.js';
import { transitionOrder } from '../src/services/orderWorkflowService.js';
import { CRM_ROLES, OPERATIONAL_ROLES } from '../src/middleware/auth.js';

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
    assert.equal(Number(queued.count), chain.length);
  } finally {
    await conn.rollback();
    conn.release();
  }
});

test.after(async () => {
  await pool.end();
});
