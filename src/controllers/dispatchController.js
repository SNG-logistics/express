import pool from '../config/db.js';

// ─── GET /dispatch/sorting ───
export async function showSortingBoard(req, res) {
  try {
    // 1. Fetch Orders at AT_DEST_WH
    // We also want to know the recipient province to group them.
    const [orders] = await pool.query(`
      SELECT o.id, o.job_no, o.direction,
             r.name AS receiver_name,
             r.phone AS receiver_phone,
             r.province AS receiver_province,
             r.city AS receiver_city
      FROM orders o
      LEFT JOIN customers r ON o.receiver_id = r.id
      WHERE o.status = 'AT_DEST_WH'
      ORDER BY r.province, o.created_at
    `);

    // Grouping logic
    const provinceGroups = {};
    orders.forEach(o => {
      const p = o.receiver_province || 'ไม่ระบุแขวง';
      if (!provinceGroups[p]) provinceGroups[p] = [];
      provinceGroups[p].push(o);
    });

    // 2. Fetch branches for Branch Allocation
    const [branches] = await pool.query(`
      SELECT id, name, branch_code, province
      FROM branches
      WHERE status = 'active'
    `);

    // 3. Fetch Partner Carriers
    const [carriers] = await pool.query(`
      SELECT id, name, name_lo
      FROM la_carriers
      WHERE is_active = 1
    `);

    res.render('dispatch/sorting', {
      user: req.session.user,
      title: 'ศูนย์คัดแยก (Sorting Board)',
      provinceGroups,
      branches,
      carriers,
    });
  } catch (error) {
    console.error('[Dispatch] showSortingBoard error:', error);
    res.status(500).render('errors/500', { user: req.session.user, title: 'Error' });
  }
}

// ─── POST /dispatch/assign ───
export async function assignOrders(req, res) {
  try {
    const { orderIds, dispatchType, branchId, carrierId, trackingNo } = req.body;
    const userId = req.session.user?.id;

    if (!orderIds || orderIds.length === 0) {
      req.session.flash = { type: 'error', message: 'กรุณาเลือกอย่างน้อย 1 ออเดอร์' };
      return res.redirect('/dispatch/sorting');
    }

    if (dispatchType === 'BRANCH_PICKUP' && !branchId) {
      req.session.flash = { type: 'error', message: 'กรุณาระบุสาขาปลายทาง' };
      return res.redirect('/dispatch/sorting');
    }

    if (dispatchType === 'PARTNER_CARRIER' && !carrierId) {
      req.session.flash = { type: 'error', message: 'กรุณาระบุบริษัทขนส่งพาร์ทเนอร์' };
      return res.redirect('/dispatch/sorting');
    }

    const oIds = Array.isArray(orderIds) ? orderIds : [orderIds];
    const newStatus = 'OUT_FOR_DELIVERY'; // Setting standard status for leaving sorting

    for (const id of oIds) {
      // Create dispatch assignment
      await pool.query(`
        INSERT INTO dispatch_assignments
        (order_id, dispatch_type, branch_id, carrier_id, carrier_tracking_no, dispatched_at, dispatched_by)
        VALUES (?, ?, ?, ?, ?, NOW(), ?)
      `, [
        id,
        dispatchType,
        dispatchType === 'BRANCH_PICKUP' ? branchId : null,
        dispatchType === 'PARTNER_CARRIER' ? carrierId : null,
        dispatchType === 'PARTNER_CARRIER' ? trackingNo : null,
        userId
      ]);

      // Update order status & branch if needed
      let setClause = 'status = ?, updated_at = NOW()';
      let setParams = [newStatus];
      
      if (dispatchType === 'BRANCH_PICKUP') {
        setClause += ', dest_branch_id = ?';
        setParams.push(branchId);
      }
      setParams.push(id);

      await pool.query(`UPDATE orders SET ${setClause} WHERE id = ?`, setParams);

      // Log it
      const title = dispatchType === 'BRANCH_PICKUP' ? 'ส่งต่อสาขา' : 'ส่งต่อพาร์ทเนอร์';
      await pool.query(`
        INSERT INTO order_status_logs (order_id, from_status, to_status, note, action_by)
        VALUES (?, 'AT_DEST_WH', ?, ?, ?)
      `, [id, newStatus, `[DISPATCH] ${title}`, userId]);
    }

    req.session.flash = { type: 'success', message: `Dispatch สำเร็จ ${oIds.length} รายการ` };
    res.redirect('/dispatch/sorting');

  } catch (error) {
    console.error('[Dispatch] assignOrders error:', error);
    req.session.flash = { type: 'error', message: 'เกิดข้อผิดพลาดในการ Dispatch' };
    res.redirect('/dispatch/sorting');
  }
}
