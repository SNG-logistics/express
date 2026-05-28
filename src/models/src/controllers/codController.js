import * as codModel from '../models/codModel.js';
import pool from '../config/db.js';

export async function index(req, res) {
  try {
    const tab = req.query.tab || 'collection';
    let query = '';
    let params = [];

    if (tab === 'remittance') {
      // Find orders collected but not remitted
      query = `
        SELECT o.*, s.name as sender_name, s.phone as sender_phone, r.name as receiver_name, r.phone as receiver_phone, cs.status as cod_status
        FROM orders o
        LEFT JOIN customers s ON s.id = o.sender_id
        LEFT JOIN customers r ON r.id = o.receiver_id
        LEFT JOIN cod_settlements cs ON cs.order_id = o.id
        WHERE o.cod_amount > 0 AND cs.status = 'COLLECTED'
        ORDER BY o.created_at DESC
      `;
    } else {
      // Find orders delivered but not collected (or no settlement record yet)
      query = `
        SELECT o.*, s.name as sender_name, s.phone as sender_phone, r.name as receiver_name, r.phone as receiver_phone, cs.status as cod_status
        FROM orders o
        LEFT JOIN customers s ON s.id = o.sender_id
        LEFT JOIN customers r ON r.id = o.receiver_id
        LEFT JOIN cod_settlements cs ON cs.order_id = o.id
        WHERE o.cod_amount > 0 AND (cs.status IS NULL OR cs.status = 'PENDING')
        ORDER BY o.created_at DESC
      `;
    }

    const [items] = await pool.query(query, params);

    res.render('cod/index', {
      user: req.session.user,
      title: 'COD Management',
      items,
      tab,
      error: null
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading COD: ' + err.message);
  }
}

export async function setAmount(req, res) {
  try {
    const { id } = req.params;
    const { cod_amount } = req.body;
    const amount = Number(cod_amount);
    if (Number.isNaN(amount) || amount < 0) {
      return res.status(400).send('จำนวน COD ไม่ถูกต้อง');
    }
    const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
    if (!order) return res.status(404).send('ไม่พบออเดอร์');
    await pool.query('UPDATE orders SET cod_amount = ? WHERE id = ?', [amount, id]);
    await codModel.ensureCodRow(id, amount);
    res.redirect('/cod');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error setting COD: ' + err.message);
  }
}

export async function markCollected(req, res) {
  try {
    const { id } = req.params;
    await codModel.markCollected(id, req.session.user?.id);
    // After collecting, it moves to 'remittance' list, but staying on collection list shows it's gone
    res.redirect('/cod?tab=collection');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error marking collected: ' + err.message);
  }
}

export async function markRemitted(req, res) {
  try {
    const { id } = req.params;
    const { remitted_to } = req.body;
    await codModel.markRemitted(id, remitted_to, req.session.user?.id);
    res.redirect('/cod?tab=remittance');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error marking remitted: ' + err.message);
  }
}
