/**
 * src/controllers/dashboardController.js
 * 
 * Thin controller — delegates all queries to dashboardModel.getDashboardData()
 * and renders the view. No business logic here.
 */

import { getDashboardData } from '../models/dashboardModel.js';

// Roles allowed to see monetary figures on the dashboard. Must mirror the
// can.* flags in src/app.js. owner is always included.
const REVENUE_ROLES = new Set(['owner', 'admin', 'manager', 'finance', 'accounting']); // can.viewRevenue
const COD_ROLES     = new Set(['owner', 'admin', 'manager', 'finance', 'accounting', 'dispatcher']); // can.viewCod

export async function dashboard(req, res) {
  try {
    const role = req.session.user?.role;
    const data = await getDashboardData({
      includeFinancials: REVENUE_ROLES.has(role),
      includeCod:        COD_ROLES.has(role),
    });

    res.render('dashboard/index', {
      title: 'Dashboard | ภาพรวม',
      ...data,
    });

  } catch (error) {
    console.error('[Dashboard] Error:', error);
    res.status(500).render('errors/500', {
      title: 'Dashboard Error',
      message: error.message,
    });
  }
}
