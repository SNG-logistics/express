import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import ejs from 'ejs';
import {
  companyField, companyPhone, companyEmail, companyName, telHref, entitySuffix,
} from '../../src/utils/companyContact.js';

const HOME  = readFileSync(new URL('../../views/customer/home.ejs', import.meta.url), 'utf8');
const LOGIN = readFileSync(new URL('../../views/auth/login.ejs', import.meta.url), 'utf8');
const GUIDE = readFileSync(new URL('../../views/order-guide.ejs', import.meta.url), 'utf8');
const CARD  = readFileSync(new URL('../../views/business-card.ejs', import.meta.url), 'utf8');
const AUTH_ROUTES = readFileSync(new URL('../../src/routes/auth.js', import.meta.url), 'utf8');
const th = JSON.parse(readFileSync(new URL('../../src/i18n/th.json', import.meta.url)));

const t = key => key.split('.').reduce((o, p) => o?.[p], th) ?? key;
const helpers = { companyPhone, companyEmail, telHref };

const renderLogin = company => ejs.render(LOGIN, {
  flash: null, title: 'x', csrfToken: 'x', company, ...helpers,
});

const renderHome = (company, lang = 'th') => ejs.render(HOME, {
  t, lang, company, portalCurrentUser: null, homeMember: null, ...helpers,
});

const BOTH = {
  company_phone: '083-754-3623',
  company_phone_th: '083-754-3623',
  company_phone_la: '020 8889 8888',
  company_address_th: 'หนองคาย',
  company_address_la: 'ບ້ານ ທົ່ງພານທອງ',
  company_name_th: 'SNG Express',
  company_name_la: 'SNG Express',
};

// ─── picking the right number ─────────────────────────────────────────────────

test("the i18n code 'lo' maps to the settings suffix '_la'", () => {
  // These two never matched, which is the whole reason a Lao reader saw Thai
  // company details.
  assert.equal(entitySuffix('lo'), 'la');
  assert.equal(entitySuffix('th'), 'th');
  assert.equal(entitySuffix(undefined), 'th');
});

test('each side of the business shows its own number', () => {
  assert.equal(companyPhone(BOTH, 'th'), '083-754-3623');
  assert.equal(companyPhone(BOTH, 'lo'), '020 8889 8888');
});

test('the legacy shared key still works for an install that only set it', () => {
  // Existing databases have company_phone filled and the pair empty. Reading
  // language-first must not blank the number that is on the site today.
  const legacyOnly = { company_phone: '083-754-3623' };
  assert.equal(companyPhone(legacyOnly, 'th'), '083-754-3623');
  assert.equal(companyPhone(legacyOnly, 'lo'), '083-754-3623');
});

test('the per-entity number beats the legacy one once it is filled in', () => {
  // This is what makes the Settings form take effect: before, editing it
  // changed a key nothing on the home page read.
  const both = { company_phone: '083-754-3623', company_phone_la: '020 8889 8888' };
  assert.equal(companyPhone(both, 'lo'), '020 8889 8888');
});

test('a blank field is skipped, not shown as empty', () => {
  // '' and '   ' are what a cleared form field submits, and they must not
  // shadow a number that is actually set.
  const sparse = { company_phone_la: '   ', company_phone: '083-754-3623' };
  assert.equal(companyPhone(sparse, 'lo'), '083-754-3623');
  assert.equal(companyPhone({}, 'lo'), '');
  assert.equal(companyPhone(null, 'th'), '');
  assert.equal(companyPhone(undefined), '');
});

test('a Lao reader falls back to the Thai number rather than to nothing', () => {
  // Reachable-but-foreign beats an empty contact panel; filling both fields in
  // Settings is what avoids it.
  assert.equal(companyPhone({ company_phone_th: '083-754-3623' }, 'lo'), '083-754-3623');
});

test('the same rule covers email and name', () => {
  assert.equal(companyEmail({ company_email_la: 'la@sng.co' }, 'lo'), 'la@sng.co');
  assert.equal(companyField({ company_address_la: 'ວຽງຈັນ' }, 'address', 'lo'), 'ວຽງຈັນ');
  assert.equal(companyName({}, 'th'), 'SNG Express', 'a nameless page is worse than a default');
});

// ─── the dialable form ────────────────────────────────────────────────────────

test('a number written for humans becomes a valid tel: target', () => {
  assert.equal(telHref('083-754-3623'), '0837543623');
  assert.equal(telHref('020 8889 8888'), '02088898888');
  assert.equal(telHref('(083) 754-3623'), '0837543623');
});

test('an international number keeps its plus', () => {
  // Dropping it turns a reachable number into an unreachable local one.
  assert.equal(telHref('+856 20 8889 8888'), '+8562088898888');
});

test('nothing dialable produces no link target', () => {
  assert.equal(telHref(''), '');
  assert.equal(telHref(null), '');
  assert.equal(telHref('ติดต่อเรา'), '');
});

// ─── the pages ────────────────────────────────────────────────────────────────

test('the Lao home page shows the Lao number beside the Lao address', () => {
  // The bug as reported: a Lao address with a Thai mobile under it.
  const html = renderHome(BOTH, 'lo');
  assert.ok(html.includes('020 8889 8888'), 'Lao number missing');
  assert.ok(html.includes('ບ້ານ ທົ່ງພານທອງ'), 'Lao address missing');
  assert.ok(!html.includes('083-754-3623'), 'Thai number still on the Lao page');
});

test('the Thai home page is unchanged', () => {
  const html = renderHome(BOTH, 'th');
  assert.ok(html.includes('083-754-3623'));
  assert.ok(!html.includes('020 8889 8888'));
});

test('the home page phone is dialable', () => {
  assert.match(renderHome(BOTH, 'th'), /href="tel:0837543623"/);
});

test('no contact set means no empty phone row', () => {
  const html = renderHome({ company_name_th: 'SNG Express' });
  assert.ok(!html.includes('href="tel:'), 'an empty tel: link is a dead tap target');
});

test('no page has the number typed into it any more', () => {
  // Four copies of one number meant changing it in Settings changed nothing.
  for (const [name, view] of [['home', HOME], ['login', LOGIN], ['order-guide', GUIDE], ['business-card', CARD]]) {
    const literals = view.match(/083[-\s]?754[-\s]?3623/g) || [];
    const placeholders = view.match(/placeholder="083[-\s]?754[-\s]?3623"/g) || [];
    assert.equal(literals.length, placeholders.length,
      `${name} still prints a hard-coded number outside a placeholder`);
  }
});

test('the login page survives a company lookup that fails', () => {
  // It is the page people reach for when something is already broken; a
  // footer line must not be able to take it down.
  assert.match(AUTH_ROUTES, /catch \(err\)[\s\S]*res\.locals\.company = \{\}/);
  const html = renderLogin({});
  assert.ok(!html.includes('href="tel:'), 'no number, no link');
});

test('the login page prints whatever number Settings holds', () => {
  const html = renderLogin(BOTH);
  assert.ok(html.includes('083-754-3623'));
  assert.match(html, /href="tel:0837543623"/);
});

test('the business card injects the number as JSON, not into a quoted string', () => {
  // The value lands inside a <script>; <%= %> would turn an apostrophe into
  // an entity and break the editor on load.
  assert.match(CARD, /phone: <%- JSON\.stringify\(companyPhone\(company, 'th'\)\) %>/);
});
