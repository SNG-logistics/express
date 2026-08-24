/**
 * src/controllers/horoscopeController.js
 *
 * GET /member/horoscope — logged-in members only (confirmed with the owner:
 * no public/guest preview). Modeled on onlineProductsController.js.
 */
import pool from '../config/db.js';
import { getDailyFortune } from '../services/horoscopeService.js';

export async function showHoroscope(req, res) {
  try {
    const [[account]] = await pool.query(
      `SELECT birth_date FROM customer_accounts WHERE id = ?`,
      [req.session.customer.id]
    );

    const fortune = account?.birth_date ? await getDailyFortune(account.birth_date) : null;

    res.render('customer/member/horoscope', {
      layout: 'customer/layout',
      title: `${res.locals.t('horoscope.title')} | SNG Express`,
      fortune,
    });
  } catch (err) {
    console.error('[Horoscope]', err);
    res.render('customer/member/horoscope', {
      layout: 'customer/layout',
      title: `${res.locals.t('horoscope.title')} | SNG Express`,
      fortune: null,
    });
  }
}
