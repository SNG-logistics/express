import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getWesternZodiac, getThaiDayZodiac } from '../../src/utils/zodiac.js';
import { pickFortuneIndex, FORTUNE_POOL_SIZE } from '../../src/data/horoscopeContent.js';
import { pickDailyProducts } from '../../src/services/horoscopeService.js';

const [
  app, route, controller, memberController, accountView, migration, migrateDb, thDict, loDict,
] = await Promise.all([
  readFile(new URL('../../src/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/routes/horoscope.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/horoscopeController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/memberController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../views/customer/member/account.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../database/migrate_046_customer_birthdate.sql', import.meta.url), 'utf8'),
  readFile(new URL('../../scripts/migrate_db.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/i18n/th.json', import.meta.url), 'utf8'),
  readFile(new URL('../../src/i18n/lo.json', import.meta.url), 'utf8'),
]);

// ── zodiac.js — pure, boundary-tested ───────────────────────────────────────

test('getWesternZodiac covers all 12 signs at their exact boundaries', () => {
  const cases = [
    ['2000-12-22', 'capricorn'], ['2000-01-19', 'capricorn'], ['2000-01-05', 'capricorn'],
    ['2000-01-20', 'aquarius'], ['2000-02-18', 'aquarius'], ['2000-02-01', 'aquarius'],
    ['2000-02-19', 'pisces'], ['2000-03-20', 'pisces'], ['2000-03-01', 'pisces'],
    ['2000-03-21', 'aries'], ['2000-04-19', 'aries'], ['2000-04-01', 'aries'],
    ['2000-04-20', 'taurus'], ['2000-05-20', 'taurus'], ['2000-05-01', 'taurus'],
    ['2000-05-21', 'gemini'], ['2000-06-20', 'gemini'], ['2000-06-01', 'gemini'],
    ['2000-06-21', 'cancer'], ['2000-07-22', 'cancer'], ['2000-07-01', 'cancer'],
    ['2000-07-23', 'leo'], ['2000-08-22', 'leo'], ['2000-08-01', 'leo'],
    ['2000-08-23', 'virgo'], ['2000-09-22', 'virgo'], ['2000-09-01', 'virgo'],
    ['2000-09-23', 'libra'], ['2000-10-22', 'libra'], ['2000-10-01', 'libra'],
    ['2000-10-23', 'scorpio'], ['2000-11-21', 'scorpio'], ['2000-11-01', 'scorpio'],
    ['2000-11-22', 'sagittarius'], ['2000-12-21', 'sagittarius'], ['2000-12-01', 'sagittarius'],
    ['2000-12-31', 'capricorn'],
  ];
  for (const [date, expected] of cases) {
    assert.equal(getWesternZodiac(date)?.key, expected, `${date} should be ${expected}`);
  }
});

test('getWesternZodiac accepts a Date object the same as an equivalent string', () => {
  assert.equal(getWesternZodiac('2000-04-15')?.key, getWesternZodiac(new Date(2000, 3, 15))?.key);
});

test('getWesternZodiac/getThaiDayZodiac return null for missing or invalid input', () => {
  assert.equal(getWesternZodiac(null), null);
  assert.equal(getWesternZodiac(undefined), null);
  assert.equal(getWesternZodiac('not-a-date'), null);
  assert.equal(getThaiDayZodiac(null), null);
  assert.equal(getThaiDayZodiac('garbage'), null);
});

test('getThaiDayZodiac maps 7 consecutive dates to 7 distinct days and 7 distinct lucky colors', () => {
  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const seenKeys = new Set();
  const seenColors = new Set();
  for (let i = 0; i < 7; i++) {
    const d = new Date(2000, 0, 2 + i); // 7 consecutive local calendar days
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const result = getThaiDayZodiac(dateStr);
    assert.equal(result.key, DAY_KEYS[d.getDay()], `${dateStr} should map to ${DAY_KEYS[d.getDay()]}`);
    assert.match(result.luckyColorHex, /^#[0-9A-Fa-f]{6}$/);
    seenKeys.add(result.key);
    seenColors.add(result.luckyColorHex);
  }
  assert.equal(seenKeys.size, 7);
  assert.equal(seenColors.size, 7);
});

test('getThaiDayZodiac accepts a Date object the same as an equivalent string', () => {
  assert.equal(getThaiDayZodiac('2000-01-02')?.key, getThaiDayZodiac(new Date(2000, 0, 2))?.key);
});

// ── horoscopeContent.js — deterministic index picker ────────────────────────

test('pickFortuneIndex is deterministic and always in range', () => {
  const a = pickFortuneIndex('2026-08-24', 'aries');
  const b = pickFortuneIndex('2026-08-24', 'aries');
  assert.equal(a, b);
  assert.ok(a >= 0 && a < FORTUNE_POOL_SIZE);
});

test('pickFortuneIndex varies with the sign, not just the date', () => {
  const signs = ['capricorn', 'aquarius', 'pisces', 'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius'];
  const indices = new Set(signs.map(key => pickFortuneIndex('2026-08-24', key)));
  assert.ok(indices.size > 1, 'expected fortune index to vary across different signs on the same day');
});

// ── horoscopeService.js — deterministic daily product rotation, pure ───────

test('pickDailyProducts returns the whole list unchanged when it already fits the daily count', () => {
  const small = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(pickDailyProducts(small, '2026-08-24'), small);
});

test('pickDailyProducts picks a stable 6-item subset of a larger list, deterministic per day', () => {
  const big = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }));
  const pickA = pickDailyProducts(big, '2026-08-24');
  const pickB = pickDailyProducts(big, '2026-08-24');
  assert.equal(pickA.length, 6);
  assert.deepEqual(pickA, pickB);
  const ids = new Set(big.map(p => p.id));
  for (const item of pickA) assert.ok(ids.has(item.id));
});

// ── Route/controller wiring ──────────────────────────────────────────────

test('the horoscope page is login-required, no public/guest route', () => {
  assert.match(route, /router\.get\('\/member\/horoscope', requireCustomerLogin, showHoroscope\)/);
  assert.doesNotMatch(route, /router\.get\('\/horoscope'/);
});

test('app.js mounts the horoscope route and restores /member on the bare bounce path', () => {
  assert.match(app, /import horoscopeRoutes from '\.\/routes\/horoscope\.js';/);
  assert.match(app, /app\.use\(horoscopeRoutes\);/);
  assert.match(app, /'\/quote-request', '\/quote-requests', '\/horoscope',/);
});

test('showHoroscope reads birth_date and degrades to a null fortune on any error, never a 500', () => {
  assert.match(controller, /SELECT birth_date FROM customer_accounts WHERE id = \?/);
  assert.match(controller, /account\?\.birth_date \? await getDailyFortune\(account\.birth_date\) : null/);
  assert.match(controller, /catch \(err\) \{/);
});

// ── Birth date collection — extends the existing profile-edit flow ────────

test('accountEdit/processAccountEdit round-trip birth_date alongside the existing fields', () => {
  assert.match(memberController, /SELECT id, phone, phone_display, first_name, last_name, gender, birth_date FROM customer_accounts/);
  assert.match(memberController, /const \{ first_name, last_name, gender, birth_date \} = req\.body;/);
  assert.match(memberController, /UPDATE customer_accounts SET first_name = \?, last_name = \?, gender = \?, birth_date = \? WHERE id = \?/);
  // Optional field: a missing/blank birth_date must not be rejected.
  assert.match(memberController, /const isValidBirthDate = !birthDateRaw/);
});

test('the account-edit view has an optional, past-only date input for birth_date', () => {
  assert.match(accountView, /name="birth_date" type="date"/);
  assert.match(accountView, /max="<%= new Date\(\)\.toISOString\(\)\.slice\(0, 10\) %>"/);
});

// ── Migration + i18n content ────────────────────────────────────────────

test('migration 046 adds an idempotent, nullable birth_date column', () => {
  assert.match(migration, /ADD COLUMN birth_date DATE NULL/);
  assert.match(migration, /information_schema\.columns/);
});

test('migrate_db.js runs migration 046 before the canonical-role-enum tail migration', () => {
  const idx046 = migrateDb.indexOf("'migrate_046_customer_birthdate.sql'");
  const idxTail = migrateDb.indexOf("'migrate_021_role_enum_canonical.sql'", idx046);
  assert.ok(idx046 > -1, 'migrate_046 should be listed');
  assert.ok(idxTail > idx046, 'the tail role-enum migration must stay last');
});

test('th.json and lo.json both carry a complete horoscope dictionary', () => {
  const th = JSON.parse(thDict);
  const lo = JSON.parse(loDict);
  for (const dict of [th, lo]) {
    assert.ok(dict.horoscope, 'horoscope namespace missing');
    assert.equal(Array.isArray(dict.horoscope.fortune), true);
    assert.equal(dict.horoscope.fortune.length, FORTUNE_POOL_SIZE);
    for (const key of ['capricorn', 'aquarius', 'pisces', 'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius']) {
      assert.ok(dict.horoscope.zodiac[key], `missing zodiac.${key}`);
    }
    for (const key of ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']) {
      assert.ok(dict.horoscope.day[key], `missing day.${key}`);
    }
  }
});

test('the fortune copy makes no money/health/luck-outcome promises', () => {
  const th = JSON.parse(thDict);
  const bannedWords = ['รวย', 'หาย', 'โชคดีมาก', 'รับรอง'];
  for (const line of th.horoscope.fortune) {
    for (const word of bannedWords) {
      assert.ok(!line.includes(word), `fortune copy should not read as a guarantee: "${line}"`);
    }
  }
});
