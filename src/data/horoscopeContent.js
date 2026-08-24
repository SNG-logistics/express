/**
 * src/data/horoscopeContent.js
 *
 * Deterministic index picker for the horoscope page's rotating "today's
 * note" copy (Phase 2: per-category — caution/love/work/money/health —
 * each rotating independently rather than sharing one index, so they don't
 * all flip in lockstep on the same days). Pure, no language/content data —
 * the actual Thai/Lao copy lives in src/data/horoscopeCopy.th.js and
 * horoscopeCopy.lo.js.
 */

export const ZODIAC_KEYS = [
  'capricorn', 'aquarius', 'pisces', 'aries', 'taurus', 'gemini',
  'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius',
];

export const CATEGORY_KEYS = ['love', 'work', 'money', 'health'];

/**
 * Deterministic index into a pool of size `poolSize` for a given
 * (date, sign, context) — same inputs always return the same index, so
 * "today's" pick is stable across reloads and only changes once the date
 * changes. `context` (e.g. 'caution', 'love') is part of the hash seed so
 * different categories rotate independently instead of all landing on the
 * same variant every day.
 * @param {string} dateKey e.g. '2026-08-24'
 * @param {string} signKey
 * @param {string} context
 * @param {number} poolSize
 * @returns {number} 0..poolSize-1
 */
export function pickIndex(dateKey, signKey, context, poolSize) {
  const seed = `${dateKey}:${signKey}:${context}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % poolSize;
}
