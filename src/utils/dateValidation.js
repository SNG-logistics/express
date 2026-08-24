/**
 * src/utils/dateValidation.js
 *
 * Small, dependency-free date helpers. Kept separate from any
 * controller/service so they can be imported directly in tests without
 * pulling in DB pools or the WhatsApp client.
 */

/**
 * 'YYYY-MM-DD' string -> true only if it's both a real calendar date (so
 * '2026-02-30' is rejected instead of reaching the DB, where it would
 * either error under strict SQL mode or roll over unpredictably) and not
 * in the future. Compares against the server's local "today", not UTC, so
 * this can never disagree with what the person actually typed relative to
 * their own wall clock — see src/utils/zodiac.js for the same reasoning
 * applied to the zodiac lookups themselves.
 */
export function isPastCalendarDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  const parsed = new Date(y, mo - 1, d);
  const isRealDate = parsed.getFullYear() === y && parsed.getMonth() === mo - 1 && parsed.getDate() === d;
  if (!isRealDate) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed.getTime() <= today.getTime();
}
