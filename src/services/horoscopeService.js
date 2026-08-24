/**
 * src/services/horoscopeService.js
 *
 * Combines the pure zodiac lookups with per-sign personality content
 * (Phase 2: traits + love/work/money/health, see src/data/horoscopeCopy.*)
 * and a deterministic daily product cross-sell for the member portal's
 * horoscope page. The product picks are NOT filtered by sign — see
 * src/utils/zodiac.js's module comment for why a generic, honestly-framed
 * pick beats faking per-sign product precision this app has no data to
 * back up. The personality/category *text*, unlike product matching, is
 * genuinely per-sign — see src/data/horoscopeCopy.th.js's module comment.
 */
import pool from '../config/db.js';
import { getWesternZodiac, getThaiDayZodiac } from '../utils/zodiac.js';
import { pickIndex, CATEGORY_KEYS } from '../data/horoscopeContent.js';
import * as copyTh from '../data/horoscopeCopy.th.js';
import * as copyLo from '../data/horoscopeCopy.lo.js';

const PRODUCT_PICK_COUNT = 6;

const COPY_BY_LANG = { th: copyTh, lo: copyLo };

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
 * @param {'th'|'lo'} lang — which language's copy to resolve; defaults to 'th'
 *   for any unrecognized value (matches i18nMiddleware's own fallback).
 * @returns {Promise<null | {
 *   westernSign: {key}, dayZodiac: {key, luckyColorHex},
 *   traits: {strengths: string[], weaknesses: string[]},
 *   today: {caution: string, love: string, work: string, money: string, health: string},
 *   products: object[]
 * }>}
 *   null when birthDate is missing/invalid — caller shows the "set your
 *   birth date" prompt instead.
 */
export async function getDailyFortune(birthDate, lang = 'th') {
  const westernSign = getWesternZodiac(birthDate);
  const dayZodiac = getThaiDayZodiac(birthDate);
  if (!westernSign || !dayZodiac) return null;

  const copy = COPY_BY_LANG[lang] || COPY_BY_LANG.th;
  const traits = copy.TRAITS[westernSign.key];
  const notes = copy.CATEGORY_NOTES[westernSign.key];

  const dateKey = todayKey();
  const today = {
    caution: notes.caution[pickIndex(dateKey, westernSign.key, 'caution', notes.caution.length)],
  };
  for (const category of CATEGORY_KEYS) {
    const pool_ = notes[category];
    today[category] = pool_[pickIndex(dateKey, westernSign.key, category, pool_.length)];
  }

  const [products] = await pool.query(
    `SELECT * FROM online_products WHERE status = 'published' ORDER BY sort_order ASC, id DESC`
  );

  return {
    westernSign,
    dayZodiac,
    traits,
    today,
    products: pickDailyProducts(products, dateKey),
  };
}
