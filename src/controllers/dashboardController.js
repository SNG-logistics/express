/**
 * src/controllers/dashboardController.js
 * 
 * Thin controller — delegates all queries to dashboardModel.getDashboardData()
 * and renders the view. No business logic here.
 */

import { getDashboardData } from '../models/dashboardModel.js';

export async function dashboard(req, res) {
  try {
    const data = await getDashboardData();

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
