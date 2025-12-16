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
      "SELECT id, job_no, sender_name, sender_phone, receiver_name, receiver_phone, route, direction, status, cod_amount, created_at FROM orders ORDER BY created_at DESC LIMIT 20"
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

    res.render('dashboard/index', {
      user: req.session.user,
      title: 'Dashboard',
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
        orders30,
        revenue30,
        directionMonthly
      },
      latest
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).send('Dashboard Error: ' + error.message);
  }
}
