/**
 * src/data/horoscopeContent.js
 *
 * Deterministic index picker for the horoscope page's "today's note" copy.
 * The pool itself is one shared, sign-agnostic list of tasteful,
 * non-promissory snippets (no money/health/luck guarantees, per the owner's
 * "เอาไม่อวยมาก" instruction) — deliberately NOT personality copy per sign,
 * which would itself be a kind of fake-precision claim this feature is
 * meant to avoid. Different signs still land on different entries on the
 * same day because the sign key is part of the hash seed. Thai/Lao text
 * lives in src/i18n/{th,lo}.json under horoscope.fortune.<index> (a flat
 * array) — this file only decides *which* index shows today, so a page
 * reload never reshuffles it.
 */

export const FORTUNE_POOL_SIZE = 6;

const ZODIAC_KEYS = [
  'capricorn', 'aquarius', 'pisces', 'aries', 'taurus', 'gemini',
  'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius',
];

/**
 * Deterministic index into a sign's fortune pool for a given date — same
 * (dateKey, sign) always returns the same index, so "today's" message is
 * stable across reloads and only changes once the date changes.
 * @param {string} dateKey e.g. '2026-08-24'
 * @param {string} signKey
 * @returns {number} 0..FORTUNE_POOL_SIZE-1
 */
export function pickFortuneIndex(dateKey, signKey) {
  const seed = `${dateKey}:${signKey}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % FORTUNE_POOL_SIZE;
}

export { ZODIAC_KEYS };
