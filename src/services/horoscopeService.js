/**
 * src/services/horoscopeService.js
 *
 * Combines the pure zodiac lookups with a deterministic daily product
 * cross-sell for the member portal's horoscope page. The product picks are
 * NOT filtered by sign — see src/utils/zodiac.js and
 * src/data/horoscopeContent.js's module comments for why a generic,
 * honestly-framed pick beats faking per-sign precision this app has no data
 * to back up.
 */
import pool from '../config/db.js';
import { getWesternZodiac, getThaiDayZodiac } from '../utils/zodiac.js';
import { pickFortuneIndex } from '../data/horoscopeContent.js';

const PRODUCT_PICK_COUNT = 6;

/** Local (not UTC) calendar day, so the daily rotation changes at server midnight. */
function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Deterministically rotate through `products` so "today's picks" is stable
 * across reloads, changes once a day, and doesn't need per-product tagging.
 * Exported for direct unit testing (pure — no DB).
 */
export function pickDailyProducts(products, dateKey) {
  if (products.length <= PRODUCT_PICK_COUNT) return products;

  let hash = 0;
  for (let i = 0; i < dateKey.length; i++) {
    hash = (hash * 31 + dateKey.charCodeAt(i)) >>> 0;
  }
  const offset = hash % products.length;

  const picked = [];
  for (let i = 0; i < PRODUCT_PICK_COUNT; i++) {
    picked.push(products[(offset + i) % products.length]);
  }
  return picked;
}

/**
 * @param {Date|string|null} birthDate
 * @returns {Promise<null | { westernSign: {key}, dayZodiac: {key, luckyColorHex}, fortuneIndex: number, products: object[] }>}
 *   null when birthDate is missing/invalid — caller shows the "set your
 *   birth date" prompt instead.
 */
export async function getDailyFortune(birthDate) {
  const westernSign = getWesternZodiac(birthDate);
  const dayZodiac = getThaiDayZodiac(birthDate);
  if (!westernSign || !dayZodiac) return null;

  const dateKey = todayKey();
  const fortuneIndex = pickFortuneIndex(dateKey, westernSign.key);

  const [products] = await pool.query(
    `SELECT * FROM online_products WHERE status = 'published' ORDER BY sort_order ASC, id DESC`
  );

  return {
    westernSign,
    dayZodiac,
    fortuneIndex,
    products: pickDailyProducts(products, dateKey),
  };
}
