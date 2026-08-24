import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';
import { getWesternZodiac, getThaiDayZodiac } from '../../src/utils/zodiac.js';
import { pickIndex, ZODIAC_KEYS, CATEGORY_KEYS } from '../../src/data/horoscopeContent.js';
import { pickDailyProducts } from '../../src/services/horoscopeService.js';
import { isPastCalendarDate } from '../../src/utils/dateValidation.js';
import * as copyTh from '../../src/data/horoscopeCopy.th.js';
import * as copyLo from '../../src/data/horoscopeCopy.lo.js';

const [
  app, route, controller, memberController, accountView, profileView, service, view, migration, migrateDb, thDict, loDict,
] = await Promise.all([
  readFile(new URL('../../src/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/routes/horoscope.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/horoscopeController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/memberController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../views/customer/member/account.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../views/customer/member/profile.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../src/services/horoscopeService.js', import.meta.url), 'utf8'),
  readFile(new URL('../../views/customer/member/horoscope.ejs', import.meta.url), 'utf8'),
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

// ── horoscopeContent.js — deterministic, per-context index picker ─────────

test('pickIndex is deterministic and always in range', () => {
  const a = pickIndex('2026-08-24', 'aries', 'love', 2);
  const b = pickIndex('2026-08-24', 'aries', 'love', 2);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 2);
});

test('pickIndex varies with the sign, not just the date', () => {
  const indices = new Set(ZODIAC_KEYS.map(key => pickIndex('2026-08-24', key, 'love', 2)));
  assert.ok(indices.size > 1, 'expected the index to vary across different signs on the same day');
});

test('pickIndex varies by context so categories do not all rotate in lockstep', () => {
  const contexts = ['caution', ...CATEGORY_KEYS];
  const indices = new Set(contexts.map(ctx => pickIndex('2026-08-24', 'aries', ctx, 2)));
  assert.ok(indices.size > 1, 'expected different categories to pick different indices on the same day for the same sign');
});

test('ZODIAC_KEYS lists exactly the 12 signs, CATEGORY_KEYS the 4 life categories', () => {
  assert.equal(ZODIAC_KEYS.length, 12);
  assert.deepEqual(CATEGORY_KEYS, ['love', 'work', 'money', 'health']);
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

test('showHoroscope reads birth_date, passes the viewer\'s language, and degrades to a null fortune on any error, never a 500', () => {
  assert.match(controller, /SELECT birth_date FROM customer_accounts WHERE id = \?/);
  assert.match(controller, /account\?\.birth_date \? await getDailyFortune\(account\.birth_date, res\.locals\.lang\) : null/);
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

test('the account-edit view has an optional, past-only date input for birth_date, computed from local time', () => {
  assert.match(accountView, /name="birth_date" type="date"/);
  assert.match(accountView, /max="<%= todayValue %>"/);
  assert.doesNotMatch(accountView, /toISOString\(\)\.slice\(0, 10\)/, 'today\'s date must come from local getters, not UTC');
});

test('processAccountEdit validates birth_date through the shared, testable helper', () => {
  assert.match(memberController, /import \{ isPastCalendarDate \} from '\.\.\/utils\/dateValidation\.js';/);
  assert.match(memberController, /isPastCalendarDate\(birthDateRaw\)/);
  assert.doesNotMatch(memberController, /toISOString\(\)\.slice\(0, 10\)/, 'the future-date check must use local time, not UTC');
});

test('isPastCalendarDate rejects calendar-invalid dates, not just malformed strings', () => {
  assert.equal(isPastCalendarDate('2026-02-30'), false, "Feb 30 doesn't exist");
  assert.equal(isPastCalendarDate('2026-13-01'), false, 'month 13 is invalid');
  assert.equal(isPastCalendarDate('2026-00-10'), false, 'month 0 is invalid');
  assert.equal(isPastCalendarDate('2026-04-31'), false, "April has 30 days, no 31st");
  assert.equal(isPastCalendarDate('not-a-date'), false);
  assert.equal(isPastCalendarDate(''), false);
});

test('isPastCalendarDate accepts a real past date and rejects a future one', () => {
  assert.equal(isPastCalendarDate('2000-02-29'), true, '2000 was a leap year, Feb 29 is real');
  assert.equal(isPastCalendarDate('1995-06-15'), true);

  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const futureStr = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
  assert.equal(isPastCalendarDate(futureStr), false);
});

test('isPastCalendarDate treats today itself as valid (not exclusively past)', () => {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.equal(isPastCalendarDate(todayStr), true);
});

test('dateValidation.js has no imports — safe to import directly in any test', async () => {
  const src = await readFile(new URL('../../src/utils/dateValidation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m);
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

test('the profile-page nav tile uses its own short hint, not the destination page\'s full subtitle', () => {
  assert.match(profileView, /href="\/member\/horoscope"/);
  assert.match(profileView, /t\('member\.horoscope'\)/);
  assert.match(profileView, /t\('member\.horoscopeHint'\)/);
  assert.doesNotMatch(profileView, /t\('horoscope\.title'\)|t\('horoscope\.subtitle'\)/);
});

test('member.horoscope/member.horoscopeHint exist in both dictionaries', () => {
  const th = JSON.parse(thDict);
  const lo = JSON.parse(loDict);
  for (const dict of [th, lo]) {
    assert.ok(dict.member.horoscope);
    assert.ok(dict.member.horoscopeHint);
  }
});

test('th.json and lo.json both carry a complete horoscope UI dictionary (chrome only — bulk copy lives elsewhere)', () => {
  const th = JSON.parse(thDict);
  const lo = JSON.parse(loDict);
  for (const dict of [th, lo]) {
    assert.ok(dict.horoscope, 'horoscope namespace missing');
    assert.equal(dict.horoscope.fortune, undefined, 'Phase 1\'s shared fortune pool should be retired, not left dangling');
    assert.ok(dict.horoscope.strengths);
    assert.ok(dict.horoscope.weaknesses);
    assert.ok(dict.horoscope.caution);
    for (const key of ['love', 'work', 'money', 'health']) {
      assert.ok(dict.horoscope.category[key], `missing category.${key}`);
    }
    for (const key of ZODIAC_KEYS) {
      assert.ok(dict.horoscope.zodiac[key], `missing zodiac.${key}`);
    }
    for (const key of ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']) {
      assert.ok(dict.horoscope.day[key], `missing day.${key}`);
    }
  }
});

test('Phase 1\'s retired horoscope.fortune key is not referenced anywhere it would need it', () => {
  for (const [label, src] of [['app.js', app], ['route', route], ['controller', controller], ['service', service], ['view', view]]) {
    assert.doesNotMatch(src, /horoscope\.fortune|pickFortuneIndex|FORTUNE_POOL_SIZE/, `${label} should not reference the retired Phase 1 API`);
  }
});

// ── horoscopeCopy.{th,lo}.js — Phase 2 per-sign content, completeness + tone ─

test('every sign has 3 strengths and 3 weaknesses, in both languages', () => {
  for (const [label, copy] of [['th', copyTh], ['lo', copyLo]]) {
    for (const sign of ZODIAC_KEYS) {
      const traits = copy.TRAITS[sign];
      assert.ok(traits, `${label}: missing TRAITS.${sign}`);
      assert.equal(traits.strengths.length, 3, `${label}: TRAITS.${sign}.strengths should have 3 entries`);
      assert.equal(traits.weaknesses.length, 3, `${label}: TRAITS.${sign}.weaknesses should have 3 entries`);
    }
  }
});

test('every sign has a 2-entry caution pool and 2-entry love/work/money/health pools, in both languages', () => {
  for (const [label, copy] of [['th', copyTh], ['lo', copyLo]]) {
    for (const sign of ZODIAC_KEYS) {
      const notes = copy.CATEGORY_NOTES[sign];
      assert.ok(notes, `${label}: missing CATEGORY_NOTES.${sign}`);
      assert.equal(notes.caution.length, 2, `${label}: CATEGORY_NOTES.${sign}.caution should have 2 entries`);
      for (const category of CATEGORY_KEYS) {
        assert.equal(notes[category]?.length, 2, `${label}: CATEGORY_NOTES.${sign}.${category} should have 2 entries`);
      }
    }
  }
});

test('the Phase 2 content makes no money/health/luck-outcome promises (TH)', () => {
  const bannedWords = ['รวย', 'โชคดีมาก', 'รับรอง', 'จะได้เงิน', 'จะหาย'];
  for (const sign of ZODIAC_KEYS) {
    const allLines = [
      ...copyTh.TRAITS[sign].strengths,
      ...copyTh.TRAITS[sign].weaknesses,
      ...copyTh.CATEGORY_NOTES[sign].caution,
      ...CATEGORY_KEYS.flatMap(category => copyTh.CATEGORY_NOTES[sign][category]),
    ];
    for (const line of allLines) {
      for (const word of bannedWords) {
        assert.ok(!line.includes(word), `${sign}: copy should not read as a guarantee: "${line}"`);
      }
    }
  }
});

test('the Phase 2 content makes no money/health/luck-outcome promises (LO)', () => {
  const bannedWords = ['ຮັ່ງມີ', 'ຮັບປະກັນ', 'ຈະໄດ້ເງິນ', 'ຈະຫາຍ'];
  for (const sign of ZODIAC_KEYS) {
    const allLines = [
      ...copyLo.TRAITS[sign].strengths,
      ...copyLo.TRAITS[sign].weaknesses,
      ...copyLo.CATEGORY_NOTES[sign].caution,
      ...CATEGORY_KEYS.flatMap(category => copyLo.CATEGORY_NOTES[sign][category]),
    ];
    for (const line of allLines) {
      for (const word of bannedWords) {
        assert.ok(!line.includes(word), `${sign}: copy should not read as a guarantee: "${line}"`);
      }
    }
  }
});

test('horoscopeService wires the Phase 2 content through pickIndex, not the retired shared pool', () => {
  assert.match(service, /import \{ pickIndex, CATEGORY_KEYS \} from '\.\.\/data\/horoscopeContent\.js';/);
  assert.match(service, /import \* as copyTh from '\.\.\/data\/horoscopeCopy\.th\.js';/);
  assert.match(service, /import \* as copyLo from '\.\.\/data\/horoscopeCopy\.lo\.js';/);
  assert.match(service, /traits = copy\.TRAITS\[westernSign\.key\]/);
});

test('the horoscope view renders traits and all 4 category cards, not the retired single fortune paragraph', () => {
  assert.match(view, /fortune\.traits\.strengths\.forEach/);
  assert.match(view, /fortune\.traits\.weaknesses\.forEach/);
  assert.match(view, /fortune\.today\[category\]/);
  assert.match(view, /fortune\.today\.caution/);
});

test('the horoscope view actually renders with real Phase 2 data, no-birth-date state, and empty products, without throwing', () => {
  const t = (key) => key;
  const noBirthDateHtml = ejs.render(view, { t, fortune: null });
  assert.match(noBirthDateHtml, /horoscope\.needBirthDate/);

  const mockFortune = {
    westernSign: { key: 'aries' },
    dayZodiac: { key: 'mon', luckyColorHex: '#FDD835' },
    traits: copyTh.TRAITS.aries,
    today: {
      caution: copyTh.CATEGORY_NOTES.aries.caution[0],
      love: copyTh.CATEGORY_NOTES.aries.love[0],
      work: copyTh.CATEGORY_NOTES.aries.work[0],
      money: copyTh.CATEGORY_NOTES.aries.money[0],
      health: copyTh.CATEGORY_NOTES.aries.health[0],
    },
    products: [],
  };
  const emptyProductsHtml = ejs.render(view, { t, fortune: mockFortune });
  assert.match(emptyProductsHtml, new RegExp(copyTh.TRAITS.aries.strengths[0]));
  assert.match(emptyProductsHtml, new RegExp(copyTh.CATEGORY_NOTES.aries.caution[0]));
  assert.match(emptyProductsHtml, /horoscope\.noProductsFound/);

  const withProducts = { ...mockFortune, products: [{ id: 1, name: 'Test Product', product_url: 'https://example.com', status: 'published' }] };
  const productsHtml = ejs.render(view, { t, fortune: withProducts });
  assert.match(productsHtml, /Test Product/);
});
