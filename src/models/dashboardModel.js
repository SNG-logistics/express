/**
 * src/models/dashboardModel.js
 * 
 * All dashboard queries in one file.
 * Called by dashboardController.js via getDashboardData().
 * 
 * Design: run all independent queries in parallel with Promise.all()
 * to keep page load < 500ms even on a busy database.
 */

import pool from '../config/db.js';

// ─── SLA Thresholds (hours) ───────────────────────────────────────────────────
export const SLA = {
  NEW_STUCK:      24,   // order stays NEW for > 24h = alert
  RECEIVED_STUCK: 48,   // order stays in WH for > 48h = alert
  CUSTOMS_HOLD:   72,   // order in customs for > 72h = alert
  DELIVERY_FAILED: 12,  // failed delivery not actioned for > 12h = alert
  COD_OVERDUE:    72,   // COD collected but not remitted for > 72h = alert
};

// ─── In-transit statuses ──────────────────────────────────────────────────────
const IN_TRANSIT = [
  'RECEIVED_WH_TH','RECEIVED_WH_LA',
  'ON_TRUCK','CROSSING_BORDER',
  'ARRIVED_BORDER_WH','CUSTOMS_HOLD','CUSTOMS_CLEARED',
  'AT_DEST_WH','BRANCH_TRANSFER','BRANCH_RECEIVED',
  'RIDER_ASSIGNED','OUT_FOR_DELIVERY',
];

/**
 * Run all dashboard queries in parallel.
 * Returns a plain object with all KPI data.
 */
export async function getDashboardData() {
  const [
    todayRow,
    todayCostRow,
    monthRow,
    monthCostRow,

    codPendingRow,
    codCollectedRow,
    codRemittedRow,
    codOverdueRow,

    statusBreakdown,

    customsHoldRows,
    customsClearedRow,
    customsRejectedRow,

    inTransitRow,
    overdueDeliveryRows,
    deliveryFailedRows,

    activeTrips,
    whPendingRows,

    topCustomers,
    successRateRows,
    plMonthly,
    orders30,
    revenue30,

    alertRows,
    latestOrders,
  ] = await Promise.all([

    // ── Revenue today ──────────────────────────────────────────
    pool.query(`
      SELECT COALESCE(SUM(price_amount),0) AS rev, COUNT(*) AS cnt
      FROM orders WHERE DATE(created_at) = CURDATE()
    `),
    pool.query(`
      SELECT COALESCE(SUM(p.amount),0) AS cost
      FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.type IN ('customs','fee','freight')
        AND (p.status IS NULL OR p.status = 'PAID')
        AND DATE(o.created_at) = CURDATE()
    `),

    // ── Revenue month ──────────────────────────────────────────
    pool.query(`
      SELECT COALESCE(SUM(price_amount),0) AS rev, COUNT(*) AS cnt
      FROM orders WHERE DATE_FORMAT(created_at,'%Y-%m') = DATE_FORMAT(CURDATE(),'%Y-%m')
    `),
    pool.query(`
      SELECT COALESCE(SUM(p.amount),0) AS cost
      FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE p.type IN ('customs','fee','freight')
        AND (p.status IS NULL OR p.status = 'PAID')
        AND DATE_FORMAT(o.created_at,'%Y-%m') = DATE_FORMAT(CURDATE(),'%Y-%m')
    `),

    // ── COD funnel ─────────────────────────────────────────────
    // Pending: DELIVERED with COD amount, not yet collected
    pool.query(`
      SELECT COALESCE(SUM(o.cod_amount),0) AS amt, COUNT(*) AS cnt
      FROM orders o
      LEFT JOIN cod_settlements cs ON cs.order_id = o.id
      WHERE o.cod_amount > 0
        AND o.status = 'DELIVERED'
        AND (cs.status IS NULL OR cs.status = 'PENDING')
    `),
    // Collected: cash received, waiting for remittance
    pool.query(`
      SELECT COALESCE(SUM(cod_amount),0) AS amt, COUNT(*) AS cnt
      FROM orders WHERE cod_amount > 0 AND status = 'COD_COLLECTED'
    `),
    pool.query(`
      SELECT COALESCE(SUM(cod_amount),0) AS amt, COUNT(*) AS cnt
      FROM orders WHERE cod_amount > 0 AND status = 'COD_REMITTED'
    `),
    // COD overdue: collected but NOT remitted for > SLA hours
    pool.query(`
      SELECT COALESCE(SUM(o.cod_amount),0) AS amt, COUNT(*) AS cnt
      FROM orders o
      LEFT JOIN order_status_logs osl
        ON osl.order_id = o.id AND osl.to_status = 'COD_COLLECTED'
      WHERE o.cod_amount > 0
        AND o.status = 'COD_COLLECTED'
        AND osl.action_at < DATE_SUB(NOW(), INTERVAL ${SLA.COD_OVERDUE} HOUR)
    `),

    // ── Status breakdown (pipeline) ────────────────────────────
    pool.query(`
      SELECT status, COUNT(*) AS cnt
      FROM orders
      WHERE status NOT IN ('CLOSED','RETURN_TO_SENDER','CUSTOMS_REJECTED')
      GROUP BY status
    `),

    // ── Customs 3-state ─────────────────────────────────────────
    pool.query(`
      SELECT o.id, o.job_no, o.direction,
             s.name AS sender_name, r.name AS receiver_name,
             TIMESTAMPDIFF(HOUR, osl.action_at, NOW()) AS hours_held,
             osl.action_at AS hold_since
      FROM orders o
      LEFT JOIN customers s ON s.id = o.sender_id
      LEFT JOIN customers r ON r.id = o.receiver_id
      LEFT JOIN order_status_logs osl
        ON osl.order_id = o.id AND osl.to_status = 'CUSTOMS_HOLD'
      WHERE o.status = 'CUSTOMS_HOLD'
      ORDER BY osl.action_at ASC
    `),
    pool.query(`
      SELECT COUNT(*) AS cnt, COALESCE(SUM(o.price_amount),0) AS rev
      FROM orders o
      WHERE o.status = 'CUSTOMS_CLEARED'
        AND DATE_FORMAT(o.created_at,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')
    `),
    pool.query(`
      SELECT COUNT(*) AS cnt
      FROM orders WHERE status = 'CUSTOMS_REJECTED'
        AND DATE_FORMAT(created_at,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')
    `),

    // ── In-transit count + overdue deliveries ──────────────────
    pool.query(`
      SELECT COUNT(*) AS cnt FROM orders
      WHERE status IN (${IN_TRANSIT.map(() => '?').join(',')})
    `, IN_TRANSIT),
    // Overdue: OUT_FOR_DELIVERY for more than 24h
    pool.query(`
      SELECT o.id, o.job_no, o.cod_amount,
             r.name AS receiver_name, r.phone AS receiver_phone,
             COALESCE(o.fail_count,0) AS fail_count,
             TIMESTAMPDIFF(HOUR, o.updated_at, NOW()) AS hours_overdue
      FROM orders o
      LEFT JOIN customers r ON r.id = o.receiver_id
      WHERE o.status = 'OUT_FOR_DELIVERY'
        AND o.updated_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY hours_overdue DESC
      LIMIT 10
    `),
    pool.query(`
      SELECT o.id, o.job_no, o.fail_reason,
             COALESCE(o.fail_count,1) AS fail_count,
             r.name AS receiver_name, r.phone AS receiver_phone,
             o.updated_at AS last_attempt
      FROM orders o
      LEFT JOIN customers r ON r.id = o.receiver_id
      WHERE o.status = 'DELIVERY_FAILED'
      ORDER BY o.fail_count DESC, o.updated_at ASC
      LIMIT 10
    `),

    // ── Active Trips ───────────────────────────────────────────
    pool.query(`
      SELECT t.id, t.trip_no, t.trip_date, t.status,
             t.origin_border, t.dest_border, t.driver_name,
             t.vehicle AS vehicle_no, t.direction,
             COUNT(to2.order_id) AS order_count
      FROM trips t
      LEFT JOIN trip_orders to2 ON to2.trip_id = t.id
      WHERE t.status NOT IN ('COMPLETED','CANCELLED','CLOSED')
      GROUP BY t.id
      ORDER BY t.trip_date DESC
      LIMIT 8
    `),
    // WH pending receive
    pool.query(`
      SELECT o.id, o.job_no, o.direction,
             s.name AS sender_name,
             TIMESTAMPDIFF(HOUR, o.created_at, NOW()) AS hours_waited
      FROM orders o
      LEFT JOIN customers s ON s.id = o.sender_id
      WHERE o.status = 'NEW'
      ORDER BY o.created_at ASC
      LIMIT 15
    `),

    // ── Executive: top customers ───────────────────────────────
    pool.query(`
      SELECT c.id, c.name,
             COUNT(o.id) AS order_count,
             COALESCE(SUM(o.price_amount),0) AS revenue
      FROM orders o
      JOIN customers c ON c.id = o.sender_id
      WHERE o.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY c.id, c.name
      ORDER BY revenue DESC
      LIMIT 5
    `),
    // Success rate (30d)
    pool.query(`
      SELECT status, COUNT(*) AS cnt
      FROM orders
      WHERE status IN ('DELIVERED','DELIVERY_FAILED','RETURN_TO_SENDER')
        AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY status
    `),
    // P&L monthly (last 3 months)
    pool.query(`
      SELECT
        DATE_FORMAT(o.created_at,'%Y-%m') AS ym,
        COALESCE(SUM(o.price_amount),0) AS revenue,
        COALESCE(SUM(p.amount),0) AS cost,
        COALESCE(SUM(o.price_amount),0) - COALESCE(SUM(p.amount),0) AS profit,
        COUNT(o.id) AS cnt
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
        AND p.type IN ('customs','fee') AND (p.status IS NULL OR p.status='PAID')
      WHERE o.created_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
      GROUP BY ym ORDER BY ym ASC
    `),
    // Chart: daily orders last 30 days
    pool.query(`
      SELECT DATE(created_at) AS d, COUNT(*) AS cnt,
             COALESCE(SUM(price_amount),0) AS rev
      FROM orders
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at) ORDER BY d ASC
    `),
    // Chart: revenue by day
    pool.query(`
      SELECT DATE(created_at) AS d, COALESCE(SUM(price_amount),0) AS rev
      FROM orders
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at) ORDER BY d ASC
    `),

    // ── Operational alerts ─────────────────────────────────────
    pool.query(`
      SELECT 'NEW_STUCK'      AS type, COUNT(*) AS cnt
      FROM orders WHERE status='NEW'
        AND created_at < DATE_SUB(NOW(), INTERVAL ${SLA.NEW_STUCK} HOUR)
      UNION ALL
      SELECT 'RECEIVED_STUCK', COUNT(*) FROM orders
      WHERE status IN ('RECEIVED_WH_TH','RECEIVED_WH_LA')
        AND updated_at < DATE_SUB(NOW(), INTERVAL ${SLA.RECEIVED_STUCK} HOUR)
      UNION ALL
      SELECT 'CUSTOMS_STUCK', COUNT(*) FROM orders
      WHERE status='CUSTOMS_HOLD'
        AND updated_at < DATE_SUB(NOW(), INTERVAL ${SLA.CUSTOMS_HOLD} HOUR)
      UNION ALL
      SELECT 'DELIVERY_FAILED', COUNT(*) FROM orders
      WHERE status='DELIVERY_FAILED'
        AND updated_at < DATE_SUB(NOW(), INTERVAL ${SLA.DELIVERY_FAILED} HOUR)
      UNION ALL
      SELECT 'COD_OVERDUE', COUNT(*) FROM orders o
      LEFT JOIN order_status_logs osl
        ON osl.order_id=o.id AND osl.to_status='COD_COLLECTED'
      WHERE o.cod_amount>0 AND o.status='COD_COLLECTED'
        AND osl.action_at < DATE_SUB(NOW(), INTERVAL ${SLA.COD_OVERDUE} HOUR)
    `),

    // ── Latest orders ──────────────────────────────────────────
    pool.query(`
      SELECT o.id, o.job_no, o.direction, o.status,
             o.price_amount, o.cod_amount, o.created_at,
             s.name AS sender_name,
             r.name AS receiver_name
      FROM orders o
      LEFT JOIN customers s ON o.sender_id = s.id
      LEFT JOIN customers r ON o.receiver_id = r.id
      ORDER BY o.created_at DESC LIMIT 15
    `),
  ]);

  // ── Process results ────────────────────────────────────────────────────────

  // Pipeline map
  const pipeline = {};
  for (const row of statusBreakdown[0]) pipeline[row.status] = Number(row.cnt);

  // Success rate
  const srMap = {};
  for (const r of successRateRows[0]) srMap[r.status] = Number(r.cnt);
  const totalResolved = Object.values(srMap).reduce((a, b) => a + b, 0);
  const successRate   = totalResolved > 0
    ? Math.round((srMap['DELIVERED'] || 0) / totalResolved * 100)
    : null;

  // Alerts map
  const alertsMap = {};
  for (const row of alertRows[0]) alertsMap[row.type] = Number(row.cnt);
  const alertTotal = Object.values(alertsMap).reduce((a, b) => a + b, 0);

  // Chart labels
  const chartLabels = orders30[0].map(r =>
    new Date(r.d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
  );

  return {
    kpi: {
      todayOrders:   Number(todayRow[0][0].cnt),
      todayRevenue:  Number(todayRow[0][0].rev),
      todayCost:     Number(todayCostRow[0][0].cost),
      todayProfit:   Number(todayRow[0][0].rev) - Number(todayCostRow[0][0].cost),

      monthOrders:   Number(monthRow[0][0].cnt),
      monthRevenue:  Number(monthRow[0][0].rev),
      monthCost:     Number(monthCostRow[0][0].cost),
      monthProfit:   Number(monthRow[0][0].rev) - Number(monthCostRow[0][0].cost),

      inTransit:     Number(inTransitRow[0][0].cnt),
      successRate,

      // COD funnel
      codPendingAmt:   Number(codPendingRow[0][0].amt),
      codPendingCnt:   Number(codPendingRow[0][0].cnt),
      codCollectedAmt: Number(codCollectedRow[0][0].amt),
      codCollectedCnt: Number(codCollectedRow[0][0].cnt),
      codRemittedAmt:  Number(codRemittedRow[0][0].amt),
      codRemittedCnt:  Number(codRemittedRow[0][0].cnt),
      codOverdueAmt:   Number(codOverdueRow[0][0].amt),
      codOverdueCnt:   Number(codOverdueRow[0][0].cnt),

      // Customs
      customsHoldCnt:     customsHoldRows[0].length,
      customsClearedCnt:  Number(customsClearedRow[0][0].cnt),
      customsRejectedCnt: Number(customsRejectedRow[0][0].cnt),
    },

    pipeline,
    alerts: { ...alertsMap, total: alertTotal },
    activeTrips:     activeTrips[0],
    whPending:       whPendingRows[0],
    customsQueue:    customsHoldRows[0],
    overdueDelivery: overdueDeliveryRows[0],
    deliveryFailed:  deliveryFailedRows[0],
    topCustomers:    topCustomers[0],
    plMonthly:       plMonthly[0],
    latest:          latestOrders[0],

    charts: {
      labels:   chartLabels,
      orders30: orders30[0].map(r => r.cnt),
      revenue30: revenue30[0].map(r => r.rev),
      plMonthly: plMonthly[0],
    },
  };
}

// ─── Standalone: COD summary for codController ───────────────────────────────
/**
 * Lightweight query for COD index page summary bar.
 * Returns { pendingAmt, pendingCnt, collectedAmt, collectedCnt, remittedAmt, remittedCnt }
 */
export async function getCodSummary() {
  const [[pending]] = await pool.query(`
    SELECT COALESCE(SUM(o.cod_amount),0) AS amt, COUNT(*) AS cnt
    FROM orders o
    LEFT JOIN cod_settlements cs ON cs.order_id = o.id
    WHERE o.cod_amount > 0
      AND o.status = 'DELIVERED'
      AND (cs.status IS NULL OR cs.status = 'PENDING')
  `);
  const [[collected]] = await pool.query(`
    SELECT COALESCE(SUM(cod_amount),0) AS amt, COUNT(*) AS cnt
    FROM orders WHERE cod_amount > 0 AND status = 'COD_COLLECTED'
  `);
  const [[remitted]] = await pool.query(`
    SELECT COALESCE(SUM(cod_amount),0) AS amt, COUNT(*) AS cnt
    FROM orders
    WHERE cod_amount > 0
      AND status = 'COD_REMITTED'
      AND DATE_FORMAT(updated_at,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')
  `);
  return {
    pendingAmt:   Number(pending.amt),
    pendingCnt:   Number(pending.cnt),
    collectedAmt: Number(collected.amt),
    collectedCnt: Number(collected.cnt),
    remittedAmt:  Number(remitted.amt),
    remittedCnt:  Number(remitted.cnt),
  };
}

// ─── Standalone: Customs queue for customsController list ────────────────────
/**
 * Fetch CUSTOMS_HOLD + count cleared/rejected this month.
 * Returns { queue: [], clearedThisMonth: N, rejectedThisMonth: N }
 */
export async function getCustomsSummary() {
  const [queue] = await pool.query(`
    SELECT o.id, o.job_no, o.direction, o.status,
           o.price_amount, o.cod_amount, o.requires_customs,
           s.name AS sender_name,
           r.name AS receiver_name,
           TIMESTAMPDIFF(HOUR, osl.action_at, NOW()) AS hours_held,
           osl.action_at AS hold_since
    FROM orders o
    LEFT JOIN customers s ON s.id = o.sender_id
    LEFT JOIN customers r ON r.id = o.receiver_id
    LEFT JOIN order_status_logs osl
      ON osl.order_id = o.id AND osl.to_status = 'CUSTOMS_HOLD'
    WHERE o.status = 'CUSTOMS_HOLD'
    ORDER BY osl.action_at ASC
  `);
  const [[cleared]] = await pool.query(`
    SELECT COUNT(*) AS cnt FROM orders
    WHERE status = 'CUSTOMS_CLEARED'
      AND DATE_FORMAT(updated_at,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')
  `);
  const [[rejected]] = await pool.query(`
    SELECT COUNT(*) AS cnt FROM orders
    WHERE status = 'CUSTOMS_REJECTED'
      AND DATE_FORMAT(updated_at,'%Y-%m') = DATE_FORMAT(NOW(),'%Y-%m')
  `);
  return {
    queue:              queue,
    clearedThisMonth:   Number(cleared.cnt),
    rejectedThisMonth:  Number(rejected.cnt),
  };
}
