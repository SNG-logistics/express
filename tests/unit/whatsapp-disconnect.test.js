import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import {
  classifyDisconnect, LOGGED_OUT, CONNECTION_REPLACED, AUTH_CLEAR_THRESHOLD,
} from '../../src/services/whatsappDisconnect.js';

const SERVICE = readFileSync(new URL('../../src/services/whatsappService.js', import.meta.url), 'utf8');
const VIEW    = readFileSync(new URL('../../views/whatsapp/index.ejs', import.meta.url), 'utf8');

// ─── a duplicate process ──────────────────────────────────────────────────────

test('a replaced session stands down instead of fighting for it', () => {
  // Two copies of the app (pm2 and Passenger both running it) each reclaimed
  // the session and kicked the other, forever. Nothing can win that race.
  const plan = classifyDisconnect({ statusCode: CONNECTION_REPLACED });
  assert.equal(plan.action, 'stand-down');
  assert.equal(plan.status, 'CONFLICT');
  assert.equal(plan.retryInMs, null, 'reconnecting is what created the loop');
});

test('a replaced session never deletes the credentials', () => {
  // This is the part that turned a duplicate process into a permanent outage:
  // one side wiped the credentials the other was still using, so both ended up
  // asking for a QR scan that could never stick.
  const plan = classifyDisconnect({ statusCode: CONNECTION_REPLACED });
  assert.equal(plan.clearAuth, false);
});

test('a conflict does not count toward the auth-clear threshold', () => {
  // Even arriving on top of earlier failures, a conflict must not be the drop
  // that tips the service into wiping its own credentials.
  const plan = classifyDisconnect({
    statusCode: CONNECTION_REPLACED,
    reconnectAttempts: AUTH_CLEAR_THRESHOLD + 5,
  });
  assert.equal(plan.clearAuth, false);
  assert.equal(plan.countsAsFailure, false);
});

test('repeated conflicts stay parked rather than drifting into a retry', () => {
  for (let attempts = 0; attempts < 10; attempts++) {
    const plan = classifyDisconnect({ statusCode: CONNECTION_REPLACED, reconnectAttempts: attempts });
    assert.equal(plan.retryInMs, null, `attempt ${attempts} tried to reconnect`);
  }
});

// ─── everything else still behaves ────────────────────────────────────────────

test('an ordinary drop reconnects', () => {
  const plan = classifyDisconnect({ statusCode: 500, errorMessage: 'Stream Errored' });
  assert.equal(plan.action, 'reconnect');
  assert.equal(plan.retryInMs, 5000);
  assert.equal(plan.clearAuth, false);
  assert.equal(plan.countsAsFailure, true);
});

test('credentials are cleared only after repeated ordinary failures', () => {
  for (let attempts = 0; attempts < AUTH_CLEAR_THRESHOLD - 1; attempts++) {
    assert.equal(classifyDisconnect({ statusCode: 500, reconnectAttempts: attempts }).clearAuth, false,
      `cleared too early at ${attempts}`);
  }
  assert.equal(classifyDisconnect({ statusCode: 500, reconnectAttempts: AUTH_CLEAR_THRESHOLD - 1 }).clearAuth, true);
});

test('an unscanned QR expiring is not a failure', () => {
  // An install left sitting on the QR screen would otherwise march itself into
  // deleting its own credentials.
  const plan = classifyDisconnect({ statusCode: 408, errorMessage: 'QR refs attempts ended' });
  assert.equal(plan.action, 'refresh-qr');
  assert.equal(plan.status, 'QR_READY');
  assert.equal(plan.countsAsFailure, false);
  assert.equal(plan.clearAuth, false);
});

test('being logged out from the phone does clear the credentials', () => {
  // Here they really are dead, and clearing is what produces a fresh QR.
  const plan = classifyDisconnect({ statusCode: LOGGED_OUT });
  assert.equal(plan.action, 'reauthenticate');
  assert.equal(plan.clearAuth, true);
  assert.equal(plan.retryInMs, 2000);
});

test('the manual off switch beats every reconnect path', () => {
  for (const statusCode of [500, LOGGED_OUT, 408]) {
    const plan = classifyDisconnect({
      statusCode, errorMessage: 'QR refs attempts ended', manuallyDisabled: true,
    });
    assert.equal(plan.retryInMs, null, `status ${statusCode} restarted a disabled service`);
    assert.equal(plan.status, 'DISABLED_MANUALLY');
  }
});

test('a close with no status code is treated as an ordinary drop', () => {
  const plan = classifyDisconnect({});
  assert.equal(plan.action, 'reconnect');
  assert.equal(plan.status, 'DISCONNECTED');
});

// ─── the numbers, and the wiring ──────────────────────────────────────────────

test('the status codes still match Baileys', async () => {
  // Copied rather than imported so this module stays side-effect free; this
  // test is what stops the copy going stale on an upgrade.
  const { DisconnectReason } = await import('@whiskeysockets/baileys');
  assert.equal(CONNECTION_REPLACED, DisconnectReason.connectionReplaced);
  assert.equal(LOGGED_OUT, DisconnectReason.loggedOut);
});

test('the service uses the classifier rather than its own copy of the rules', () => {
  assert.match(SERVICE, /classifyDisconnect\(\{/);
  assert.ok(!/statusCode !== DisconnectReason\.loggedOut/.test(SERVICE),
    'the old inline rule is still deciding');
});

test('every credential path is absolute', () => {
  // Baileys resolved a bare relative name against process.cwd() while the
  // clearing code used __dirname — so under Passenger the app wrote its
  // credentials to one folder and emptied another, and "Delete session"
  // appeared to do nothing.
  assert.ok(!/useMultiFileAuthState\('auth_info_baileys'\)/.test(SERVICE),
    'auth state is still resolved against the working directory');
  assert.match(SERVICE, /useMultiFileAuthState\(AUTH_PATH\)/);
  const literals = SERVICE.match(/'\.\.\/\.\.\/(auth_info_baileys|DISABLE_WHATSAPP)'/g) || [];
  assert.equal(literals.length, 2, 'the two paths must be built in exactly one place each');
});

test('a conflict counts as down, so the dashboard alert fires', () => {
  // The service stops reconnecting in this state; without the alert the
  // notification outbox would stall with nothing on screen explaining it.
  assert.match(SERVICE, /DOWN_STATUSES = new Set\(\[[^\]]*'CONFLICT'/);
});

test('the status page explains a conflict instead of showing one word', () => {
  assert.match(VIEW, /case 'CONFLICT':/);
  assert.match(VIEW, /conflictContainer/);
  assert.ok(VIEW.includes('การสแกน QR ใหม่ไม่ช่วยแก้'), 'must say what will not work');
  assert.ok(VIEW.includes('passenger'), 'must name the second runtime to look for');
  assert.ok(VIEW.includes('auth_info_baileys'), 'must mention copied credentials');
});

test('the conflict panel is hidden again when the state changes', () => {
  // Every other panel is reset at the top of updateUI; a panel that only ever
  // appears would stay on screen after the connection recovered.
  const updateUi = VIEW.slice(VIEW.indexOf('function updateUI'));
  assert.match(updateUi.slice(0, updateUi.indexOf('switch')), /conflictContainer\.classList\.add\('hidden'\)/);
});
