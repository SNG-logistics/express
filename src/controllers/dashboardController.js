import pool from '../config/db.js';

export async function dashboard(req, res) {
  try {
    const [[todayRevenue]] = await pool.query(
      "SELECT COALESCE(SUM(price_amount),0) AS rev, COUNT(*) AS cnt FROM orders WHERE DATE(created_at)=CURDATE()"
    );
    const [[todayCost]] = await pool.query(
      `SELECT COALESCE(SUM(p.amount),0) AS cost
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.type IN ('customs','fee','freight')
         AND (p.status IS NULL OR p.status = 'PAID')
         AND DATE(o.created_at)=CURDATE()`
    );

    const [[monthRevenue]] = await pool.query(
      "SELECT COALESCE(SUM(price_amount),0) AS rev, COUNT(*) AS cnt FROM orders WHERE DATE_FORMAT(created_at,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')"
    );
    const [[monthCost]] = await pool.query(
      `SELECT COALESCE(SUM(p.amount),0) AS cost
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.type IN ('customs','fee','freight')
         AND (p.status IS NULL OR p.status = 'PAID')
         AND DATE_FORMAT(o.created_at,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')`
    );

    const [[codPending]] = await pool.query(
      `SELECT COALESCE(SUM(cod_amount),0) AS cod_pending
       FROM orders
       WHERE cod_amount > 0 AND status IN ('DELIVERED','COD_COLLECTED')`
    );

    // New KPI metrics for Thai-Lao dashboard
    const [[inTransitCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM orders 
       WHERE status IN ('RECEIVED','CROSS_BORDER','AT_DEST_WH','DEPARTED')`
    );

    const [[deliveredCount]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM orders WHERE status = 'DELIVERED'`
    );

    const [latest] = await pool.query(
      `SELECT 
        o.id, o.job_no, o.direction, o.status, o.cod_amount, o.created_at,
        s.name AS sender_name, s.phone AS sender_phone,
        r.name AS receiver_name, r.phone AS receiver_phone
       FROM orders o
       LEFT JOIN customers s ON o.sender_id = s.id
       LEFT JOIN customers r ON o.receiver_id = r.id
       ORDER BY o.created_at DESC 
       LIMIT 20`
    );
    const [orders30] = await pool.query(
      `SELECT DATE(created_at) AS d, COUNT(*) AS cnt
       FROM orders
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY DATE(created_at)
       ORDER BY d ASC`
    );
    const [revenue30] = await pool.query(
      `SELECT DATE(created_at) AS d, COALESCE(SUM(price_amount),0) AS rev
       FROM orders
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY DATE(created_at)
       ORDER BY d ASC`
    );
    const [directionMonthly] = await pool.query(
      `SELECT DATE_FORMAT(created_at,'%Y-%m') AS ym, direction, COUNT(*) AS cnt, COALESCE(SUM(price_amount),0) AS rev
       FROM orders
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
       GROUP BY ym, direction
       ORDER BY ym ASC`
    );


    // Process Chart Data
    const labels = orders30.map(item => {
      const date = new Date(item.d);
      return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    });

    // Process Latest Orders Status
    const statusMap = {
      'NEW': { status: 'new', label: 'ใหม่' },
      'RECEIVED': { status: 'received', label: 'รับของ' },
      'CROSS_BORDER': { status: 'crossing', label: 'ข้ามแดน' },
      'AT_DEST_WH': { status: 'warehouse', label: 'ถึงคลัง' },
      'DEPARTED': { status: 'delivery', label: 'กำลังส่ง' },
      'DELIVERED': { status: 'completed', label: 'สำเร็จ' },
      'COD_COLLECTED': { status: 'completed', label: 'สำเร็จ' },
      'COMPLETED': { status: 'completed', label: 'สำเร็จ' }
    };

    const processedLatest = latest.map(order => {
      const statusInfo = statusMap[order.status] || { status: 'new', label: order.status };
      return {
        ...order,
        status: statusInfo.status, // overwrite with lowercase class
        statusLabel: statusInfo.label
      };
    });

    res.render('dashboard/index', {
      user: req.session.user,
      title: 'Dashboard | ภาพรวม',
      kpi: {
        todayOrders: todayRevenue.cnt,
        todayRevenue: todayRevenue.rev,
        monthOrders: monthRevenue.cnt,
        monthRevenue: monthRevenue.rev,
        todayProfit: todayRevenue.rev - todayCost.cost,
        monthProfit: monthRevenue.rev - monthCost.cost,
        codPending: codPending.cod_pending,
        inTransit: inTransitCount.cnt,
        delivered: deliveredCount.cnt
      },
      charts: {
        labels,
        orders30: orders30.map(i => i.cnt),
        revenue30: revenue30.map(i => i.rev),
        directionMonthly
      },
      latest: processedLatest
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).send('Dashboard Error: ' + error.message);
  }
}
