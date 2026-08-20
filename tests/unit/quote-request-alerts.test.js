import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

const [controller, routes, queueView] = await Promise.all([
  readFile(new URL('../../src/controllers/partnerController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/routes/partner.js', import.meta.url), 'utf8'),
  readFile(new URL('../../views/partner/quote-requests.ejs', import.meta.url), 'utf8'),
]);

test('staff-only pending quote request API returns fresh queue items without caching', () => {
  assert.match(
    routes,
    /const staff = requireRole\(\['owner', 'admin', 'manager', 'staff', 'branch_operator'\]\)/,
  );
  assert.match(controller, /export async function pendingQuoteRequestsApi/);
  assert.match(controller, /WHERE pqr\.status = 'new'/);
  assert.match(controller, /res\.set\('Cache-Control', 'no-store'\)/);
  assert.match(controller, /res\.json\(\{ requests \}\)/);
  assert.match(
    routes,
    /router\.get\('\/partner\/api\/quote-requests\/pending', requireLogin, staff, partner\.pendingQuoteRequestsApi\)/
  );
});

test('staff queue alerts describe the request and open its pre-filled quotation form', () => {
  assert.match(queueView, /fetch\('\/partner\/api\/quote-requests\/pending'/);
  assert.match(queueView, /setInterval\(pollPendingRequests, 15000\)/);
  assert.match(queueView, /ลูกค้าต้องการ:/);
  assert.match(queueView, /data-alert-customer/);
  assert.match(queueView, /\.textContent =/);
  assert.match(
    queueView,
    /\/partner\/quote-requests\/\$\{encodeURIComponent\(request\.id\)\}\/convert/
  );
  assert.match(queueView, /quoteAlertSoundToggle/);
  // The beep and the "already alerted" bookkeeping moved to public/js/quote-alert.js,
  // shared with the header bell (both poll the same endpoint and can be on
  // screen together) — see quote-alert-shared.test.js. This page must use
  // that shared object rather than keep its own copy of either concern.
  assert.match(queueView, /window\.quoteAlert\.claimBatch/);
  assert.match(queueView, /window\.quoteAlert\.play\(\)/);
  assert.match(queueView, /window\.quoteAlert\.enableSound\(\)/);
  assert.doesNotMatch(queueView, /AudioContext/, 'the beep must not be duplicated on this page');
  assert.doesNotMatch(queueView, /knownRequestIds/, 'dedupe must go through the shared store, not a local Set');
});

test('staff quote queue renders the alert shell when there are no existing requests', () => {
  const html = ejs.render(queueView, { requests: [] });
  assert.match(html, /id="quoteRequestAlerts"/);
  assert.match(html, /id="quoteAlertSoundToggle"/);
});
