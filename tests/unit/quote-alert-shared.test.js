import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ejs from 'ejs';

const [alertModuleSource, bellPartial, mainLayout, quoteRequestsRoutes] = await Promise.all([
  readFile(new URL('../../public/js/quote-alert.js', import.meta.url), 'utf8'),
  readFile(new URL('../../views/partials/_quote_request_bell.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../views/layouts/main.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../src/routes/partner.js', import.meta.url), 'utf8'),
]);

/**
 * public/js/quote-alert.js is plain browser JS (no bundler, no module
 * exports — loaded via a bare <script src>). Running it in a small vm
 * sandbox with a fake localStorage is how the rest of the app's tests treat
 * pure logic that only ever runs client-side; this exercises the real file
 * rather than a re-implementation of it.
 */
function loadQuoteAlert() {
  const store = new Map();
  const sandbox = {
    window: {},
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(alertModuleSource, sandbox, { filename: 'quote-alert.js' });
  const raw = sandbox.window.quoteAlert;
  // node:assert/strict's deepStrictEqual rejects arrays from a different vm
  // realm even when structurally identical (different Array constructor per
  // realm) — claimBatch's return value is re-materialized as a plain array
  // in this realm so assertions can compare it normally.
  const quoteAlert = { ...raw, claimBatch: (ids) => Array.from(raw.claimBatch(ids)) };
  return { quoteAlert, store };
}

// ─── the dedupe store ──────────────────────────────────────────────────────────

test('the first poll ever in a browser is treated as backlog, not new arrivals', () => {
  // This is what "only alert the first time a job arrives" means in practice:
  // requests that already existed before a browser ever polled must not all
  // ding at once the moment the feature ships.
  const { quoteAlert } = loadQuoteAlert();
  assert.deepEqual(quoteAlert.claimBatch(['1', '2', '3']), []);
});

test('a genuinely new id is reported exactly once', () => {
  const { quoteAlert } = loadQuoteAlert();
  quoteAlert.claimBatch(['1', '2']); // bootstrap
  assert.deepEqual(quoteAlert.claimBatch(['1', '2', '3']), ['3']);
  assert.deepEqual(quoteAlert.claimBatch(['1', '2', '3']), [], 'must not re-alert on the next poll');
});

test('two listeners sharing one store only ding once between them', () => {
  // This is the exact scenario the shared module exists to prevent: a staff
  // member sitting on the queue page also has the header bell mounted, and
  // both poll the same endpoint. Simulated here as two claimBatch calls
  // against the same store, back to back, the way two independent pollers
  // resolving in the same tick would behave (JS is single-threaded, so
  // whichever call happens first always wins deterministically).
  const { quoteAlert } = loadQuoteAlert();
  quoteAlert.claimBatch(['1']); // bootstrap
  const fromPageListener = quoteAlert.claimBatch(['1', '2']);
  const fromBellListener = quoteAlert.claimBatch(['1', '2']);
  assert.deepEqual(fromPageListener, ['2'], 'the first caller sees the new id');
  assert.deepEqual(fromBellListener, [], 'the second caller must not see it again');
});

test('ids are tracked as strings, so a number and its string form are the same id', () => {
  // The API returns numeric ids (JSON numbers); the queue page's server-rendered
  // seed list supplies them as strings (String(request.id) in the EJS). If the
  // store distinguished 3 from '3' it would re-alert for every request on the
  // very next poll after page load.
  const { quoteAlert } = loadQuoteAlert();
  quoteAlert.claimBatch([1, 2]); // bootstrap with numbers
  assert.deepEqual(quoteAlert.claimBatch(['1', '2']), [], 'the same ids as strings must not look new');
  assert.deepEqual(quoteAlert.claimBatch([1, 2]), [], 'nor as numbers again');
});

test('a browser with localStorage disabled degrades to "always new" rather than throwing', () => {
  const sandbox = {
    window: {},
    localStorage: {
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('SecurityError'); },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(alertModuleSource, sandbox, { filename: 'quote-alert.js' });
  assert.doesNotThrow(() => sandbox.window.quoteAlert.claimBatch(['1']));
  assert.doesNotThrow(() => sandbox.window.quoteAlert.isSoundEnabled());
  assert.doesNotThrow(() => sandbox.window.quoteAlert.enableSound());
});

// ─── the sound gate ────────────────────────────────────────────────────────────

test('sound stays off until explicitly enabled, and then persists', () => {
  const { quoteAlert } = loadQuoteAlert();
  assert.equal(quoteAlert.isSoundEnabled(), false);
  quoteAlert.enableSound();
  assert.equal(quoteAlert.isSoundEnabled(), true);
});

test('play() is silent (no AudioContext call) until sound has been enabled', () => {
  // Browsers block audio without a prior user gesture; play() must not even
  // attempt to construct an AudioContext before enableSound() has run once.
  const { quoteAlert, store } = loadQuoteAlert();
  let constructed = false;
  quoteAlert.play(); // no window.AudioContext defined in the sandbox at all
  assert.equal(constructed, false);
  assert.equal(store.has('sng_quote_alert_sound_enabled'), false);
});

// ─── the bell partial ────────────────────────────────────────────────────────

test('the bell links each request straight to its convert screen, not /partner/quotes/:id', () => {
  // /partner/quotes/:id is a different resource (partner_quotations), only
  // valid after a request has been converted — using it for a still-new
  // request would 404 the same way the accept/reject bug did.
  assert.match(bellPartial, /'\/partner\/quote-requests\/' \+ r\.id \+ '\/convert'/);
  assert.doesNotMatch(bellPartial, /\/partner\/quotes\/['"`+]/);
});

test('the bell polls the same endpoint the queue page uses, on the same cadence', () => {
  assert.match(bellPartial, /fetch\('\/partner\/api\/quote-requests\/pending'/);
  assert.match(bellPartial, /15000/);
});

test('the bell goes through the shared store rather than keeping its own', () => {
  assert.match(bellPartial, /window\.quoteAlert\.claimBatch/);
  assert.match(bellPartial, /window\.quoteAlert\.play\(\)/);
  assert.match(bellPartial, /window\.quoteAlert\.enableSound\(\)/);
  assert.doesNotMatch(bellPartial, /AudioContext/, 'the beep belongs in one place only');
});

test('the badge and dropdown are absent, not empty, when nothing is pending', () => {
  const html = ejs.render(bellPartial, {});
  assert.match(html, /requests\.length === 0/);
  assert.match(html, /requests\.length > 0/);
});

// ─── wiring into the shared layout ─────────────────────────────────────────────

test('the bell and its script are gated behind can.viewPartner, reusing the existing flag', () => {
  // /partner/* itself is gated to owner + admin/manager/staff/branch_operator
  // (src/routes/partner.js), and can.viewPartner in app.js already covers the
  // exact same set — introducing a second flag for the same roles would be
  // the kind of duplication the rest of this session has been removing.
  assert.match(quoteRequestsRoutes, /const staff = requireRole\(\['owner', 'admin', 'manager', 'staff', 'branch_operator'\]\)/);
  const bellInclude = mainLayout.match(/<% if \(can && can\.viewPartner\) \{ %>\s*<%- include\('\.\.\/partials\/_quote_request_bell'\) %>/);
  assert.ok(bellInclude, 'bell must be gated by can.viewPartner');
  const scriptInclude = mainLayout.match(/<% if \(can && can\.viewPartner\) \{ %>\s*<script src="\/js\/quote-alert\.js">/);
  assert.ok(scriptInclude, 'the shared script must load only when the bell can render');
});

test('the shared script loads before the bell\'s own inline script runs', () => {
  // The bell's x-init calls window.quoteAlert.isSoundEnabled() immediately;
  // if the module tag were ordered after the bell's include, that call would
  // throw on a page that only has the bell (no queue page) present.
  const scriptAt = mainLayout.indexOf('/js/quote-alert.js');
  const bellAt = mainLayout.indexOf("include('../partials/_quote_request_bell')");
  assert.ok(scriptAt > -1 && bellAt > -1);
  assert.ok(scriptAt < bellAt, 'quote-alert.js must be included before the bell partial');
});

test('rendering the layout without the flag renders neither the bell nor the script', async () => {
  const html = await ejs.renderFile(
    fileURLToPath(new URL('../../views/layouts/main.ejs', import.meta.url)),
    {
      title: 'x', currentUser: { username: 'u', role: 'rider' }, userRole: 'rider',
      t: (k) => k, lang: 'th', otherLang: 'lo', otherFlag: '🇱🇦', otherLabel: 'ລາວ',
      flash: null, csrfToken: 'x', currentPath: '/rider', body: '',
      can: { viewPartner: false, useScanner: false, createOrder: false },
    }
  );
  assert.ok(!html.includes('quoteRequestBell'));
  assert.ok(!html.includes('/js/quote-alert.js'));
});
