/**
 * prohibitedItemsService.js — what SNG will and will not carry.
 *
 * Two lists, because the honest answer has two shapes: things never carried,
 * and things carried under conditions that depend on the specific item.
 * Collapsing them into one would either scare off business SNG can take, or
 * promise carriage SNG cannot guarantee.
 *
 * This matters more for purchase-agent orders than for ordinary parcels: a
 * customer pays a deposit before the goods exist, so finding out at the border
 * costs them money, not just time.
 */
import pool from '../config/db.js';

/** Reading is on a hot path (every quote form and estimate page) and the list
 *  changes about as often as customs rules do, so it is cached in process. */
let cache = null;
let cachedAt = 0;
const CACHE_MS = 5 * 60 * 1000;

/** Call after an edit so staff see their own change immediately. */
export function invalidateProhibitedItemsCache() {
  cache = null;
}

function pickLang(row, lang) {
  const lo = lang === 'lo';
  return {
    id: row.id,
    category: row.category,
    label: (lo ? row.label_lo : row.label_th) || row.label_th,
    note: (lo ? row.note_lo : row.note_th) || null,
  };
}

/**
 * @param {'th'|'lo'} lang
 * @returns {Promise<{banned: Array, askFirst: Array}>} empty lists on failure —
 *   a database hiccup must not take down the page a customer is shopping on.
 */
export async function getProhibitedItems(lang = 'th') {
  try {
    if (!cache || Date.now() - cachedAt > CACHE_MS) {
      const [rows] = await pool.query(
        `SELECT id, category, label_th, label_lo, note_th, note_lo
         FROM prohibited_items
         WHERE active = 1
         ORDER BY category ASC, sort_order ASC, id ASC`
      );
      cache = rows;
      cachedAt = Date.now();
    }
    return {
      banned: cache.filter(r => r.category === 'BANNED').map(r => pickLang(r, lang)),
      askFirst: cache.filter(r => r.category === 'ASK_FIRST').map(r => pickLang(r, lang)),
    };
  } catch (error) {
    console.error('[ProhibitedItems] load failed:', error.message);
    return { banned: [], askFirst: [] };
  }
}

/** Every row, both languages, for the staff screen that edits them. */
export async function listAllProhibitedItems() {
  const [rows] = await pool.query(
    `SELECT * FROM prohibited_items ORDER BY category ASC, sort_order ASC, id ASC`
  );
  return rows;
}
