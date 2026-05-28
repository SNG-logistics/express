import pool from './src/config/db.js';
import ejs from 'ejs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testRender() {
  const id = 3;
  try {
    const [[order]] = await pool.query(
      `SELECT o.*,
              s.name as sender_name, s.address as sender_address, s.phone as sender_phone, s.id as sender_cid,
              r.name as receiver_name, r.address as receiver_address, r.phone as receiver_phone, r.id as receiver_cid,
              t.trip_no, t.status as trip_status, t.driver_name, t.vehicle as vehicle_no,
              t.origin_border, t.dest_border, t.trip_date, t.direction as trip_direction,
              TIMESTAMPDIFF(HOUR, o.updated_at, NOW()) AS hours_since_update,
              TIMESTAMPDIFF(HOUR, o.created_at, NOW()) AS hours_since_created
       FROM orders o
       LEFT JOIN customers s ON s.id = o.sender_id
       LEFT JOIN customers r ON r.id = o.receiver_id
       LEFT JOIN trips t ON t.id = o.trip_id
       WHERE o.id = ?`,
      [id]
    );
    if (!order) { console.log('Order not found'); process.exit(1); }

    const [logs] = await pool.query(
      `SELECT osl.*, u.username, u.role as action_role
       FROM order_status_logs osl
       LEFT JOIN users u ON u.id = osl.action_by
       WHERE osl.order_id = ?
       ORDER BY osl.action_at DESC`,
      [id]
    );

    const [payments] = await pool.query('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at ASC', [id]);

    let codSettlement = null;
    const [[cs]] = await pool.query(
      `SELECT cs.*, TIMESTAMPDIFF(HOUR, cs.collected_at, NOW()) AS hours_since_collected
       FROM cod_settlements cs WHERE cs.order_id = ? LIMIT 1`, [id]
    );
    codSettlement = cs || null;

    let customsHoldLog = null;
    let orderFlags = [];

    const data = {
      order,
      logs,
      payments,
      codSettlement,
      customsHoldLog,
      orderFlags,
      flash: null,
      can: { viewRevenue: true, viewFinancials: true, manageCustoms: true, resolveFlag: true, markDelivered: true },
      user: { role: 'admin', username: 'admin' },
      title: `Order ${order.job_no}`,
      error: null,
      csrfToken: 'test-token',
      currentPath: '/orders/3'
    };

    const filePath = path.join(__dirname, 'views/orders/detail.ejs');
    ejs.renderFile(filePath, data, (err, str) => {
      if (err) {
        console.error('RENDER ERROR MESSAGE:', err.message);
      } else {
        console.log('Render Success!');
      }
      process.exit(0);
    });
  } catch (err) {
    console.error('Test Failed:', err);
    process.exit(1);
  }
}

testRender();
