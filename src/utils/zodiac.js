/**
 * src/utils/zodiac.js
 *
 * Pure, deterministic date -> zodiac lookups for the member portal's
 * "ดูดวง" (horoscope) page. No external API/library, no randomness —
 * display names/copy are pulled from src/i18n/{th,lo}.json by the keys
 * returned here (see horoscope.zodiac.* / horoscope.day.*), matching how
 * every other page in this app keeps computed data and language separate.
 */

// Ordered by end-of-range month/day so getWesternZodiac can scan once.
// Ranges follow the standard tropical zodiac (Jan 1 - Dec 31 wrap handled
// separately for Capricorn).
const WESTERN_SIGNS = [
  { key: 'capricorn', from: [1, 1], to: [1, 19] },
  { key: 'aquarius', from: [1, 20], to: [2, 18] },
  { key: 'pisces', from: [2, 19], to: [3, 20] },
  { key: 'aries', from: [3, 21], to: [4, 19] },
  { key: 'taurus', from: [4, 20], to: [5, 20] },
  { key: 'gemini', from: [5, 21], to: [6, 20] },
  { key: 'cancer', from: [6, 21], to: [7, 22] },
  { key: 'leo', from: [7, 23], to: [8, 22] },
  { key: 'virgo', from: [8, 23], to: [9, 22] },
  { key: 'libra', from: [9, 23], to: [10, 22] },
  { key: 'scorpio', from: [10, 23], to: [11, 21] },
  { key: 'sagittarius', from: [11, 22], to: [12, 21] },
  { key: 'capricorn', from: [12, 22], to: [12, 31] },
];

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Traditional Thai day-of-week lucky colors (ดวงประจำวันเกิด). Wednesday's
// day/night (กลางวัน/ราหู) split is a real distinction in some traditions but
// is deliberately not modeled here — one color per day keeps this simple and
// avoids needing a birth *time*, which this app does not collect.
const DAY_LUCKY_COLOR = {
  sun: '#E53935', // แดง
  mon: '#FDD835', // เหลือง
  tue: '#EC407A', // ชมพู
  wed: '#43A047', // เขียว
  thu: '#FB8C00', // ส้ม
  fri: '#29B6F6', // ฟ้า
  sat: '#8E24AA', // ม่วง
};

/**
 * Extracts { month (1-12), day, weekday (0=Sun..6=Sat) } straight from the
 * input's own year/month/day fields, deliberately avoiding any UTC<->local
 * timezone conversion: a `DATE` column has no time component, so converting
 * through it can shift the date by a day depending on the server's timezone
 * offset (mysql2 returns `DATE` columns as `Date` objects built from local
 * getters, not UTC — a plain `'YYYY-MM-DD'` string, e.g. from an HTML date
 * input, is parsed directly instead of going through `new Date(string)`,
 * which treats date-only strings as UTC and would reintroduce the same bug).
 */
function toParts(birthDate) {
  if (typeof birthDate === 'string') {
    const m = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const [, , mm, dd] = m;
    const month = Number(mm);
    const day = Number(dd);
    // Sunday=0 via Zeller-independent trick: build a local Date from the
    // same numeric fields (not the string) so no UTC parsing is involved.
    const weekday = new Date(Number(m[1]), month - 1, day).getDay();
    return { month, day, weekday };
  }
  if (birthDate instanceof Date && !Number.isNaN(birthDate.getTime())) {
    return { month: birthDate.getMonth() + 1, day: birthDate.getDate(), weekday: birthDate.getDay() };
  }
  return null;
}

/**
 * @param {Date|string} birthDate
 * @returns {{ key: string } | null} the 12-sign zodiac key (e.g. 'aries'),
 *   or null when birthDate is missing/invalid.
 */
export function getWesternZodiac(birthDate) {
  const parts = toParts(birthDate);
  if (!parts) return null;
  const { month, day } = parts;

  const sign = WESTERN_SIGNS.find(({ from, to }) => {
    const afterStart = month > from[0] || (month === from[0] && day >= from[1]);
    const beforeEnd = month < to[0] || (month === to[0] && day <= to[1]);
    return afterStart && beforeEnd;
  });

  return sign ? { key: sign.key } : null;
}

/**
 * @param {Date|string} birthDate
 * @returns {{ key: string, luckyColorHex: string } | null} the day-of-week
 *   key (e.g. 'mon') and its traditional lucky color, or null when
 *   birthDate is missing/invalid.
 */
export function getThaiDayZodiac(birthDate) {
  const parts = toParts(birthDate);
  if (!parts) return null;

  const key = DAY_KEYS[parts.weekday];
  return { key, luckyColorHex: DAY_LUCKY_COLOR[key] };
}
