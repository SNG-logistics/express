import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import ejs from 'ejs';
import { decodePlusCode, encodePlusCode, isShortPlusCode } from '../../src/utils/plusCode.js';
import { resolveBranchPosition } from '../../src/controllers/branchesController.js';

const PARTIAL = readFileSync(new URL('../../views/branches/_plus_code.ejs', import.meta.url), 'utf8');
const ROUTES  = readFileSync(new URL('../../src/routes/branches.js', import.meta.url), 'utf8');
const NEW     = readFileSync(new URL('../../views/branches/new.ejs', import.meta.url), 'utf8');
const EDIT    = readFileSync(new URL('../../views/branches/edit.ejs', import.meta.url), 'utf8');

// Vientiane — the hub the Lao branches sit around.
const VTE = { lat: 17.9757, lng: 102.6331 };
const FULL = encodePlusCode(VTE.lat, VTE.lng);

const render = (locals = {}) => ejs.render(PARTIAL, {
  lat: '', lng: '', code: '', plusCode: null, accent: 'amber', ...locals,
});

// ─── the codec ────────────────────────────────────────────────────────────────

test('a full code decodes back to the place it was made from', () => {
  const got = decodePlusCode(FULL);
  assert.ok(got, 'a code produced by encodePlusCode must decode');
  // A 10-digit code is a ~14 m cell, so the centre is within metres.
  assert.ok(Math.abs(got.lat - VTE.lat) < 0.001, `lat drifted: ${got.lat}`);
  assert.ok(Math.abs(got.lng - VTE.lng) < 0.001, `lng drifted: ${got.lng}`);
  assert.equal(got.wasShort, false);
});

test('a short code with no reference is refused, not guessed', () => {
  // This is the whole hazard. "JJXX+HR8" repeats roughly every degree; picking
  // a reference ourselves returns a confident answer several kilometres away,
  // which would misprice every delivery from the branch without ever looking
  // wrong on screen.
  assert.equal(decodePlusCode('JJXX+HR8'), null);
  assert.equal(decodePlusCode('JJXX+HR8', null, null), null);
  assert.equal(decodePlusCode('JJXX+HR8', 17.9757, undefined), null);
  assert.equal(isShortPlusCode('JJXX+HR8'), true);
});

test('a short code recovers against a nearby reference', () => {
  const short = FULL.slice(4);              // what Maps shows next to the locality
  const got = decodePlusCode(short, VTE.lat, VTE.lng);
  assert.ok(got, 'a short code plus a reference is enough');
  assert.equal(got.wasShort, true);
  assert.ok(Math.abs(got.lat - VTE.lat) < 0.01, `recovered the wrong cell: ${got.lat}`);
  assert.ok(Math.abs(got.lng - VTE.lng) < 0.01, `recovered the wrong cell: ${got.lng}`);
  assert.equal(isShortPlusCode(got.code), false, 'the recovered code is a full one');
});

test('a reference on the far side of the country recovers a different place', () => {
  // Documenting the failure this design avoids, so nobody later "helpfully"
  // supplies a default reference: the same short code, referenced elsewhere,
  // decodes elsewhere — silently.
  const short = FULL.slice(4);
  const near = decodePlusCode(short, VTE.lat, VTE.lng);
  const far  = decodePlusCode(short, 14.0, 101.0);
  assert.ok(near && far);
  assert.ok(Math.abs(near.lat - far.lat) > 1, 'the reference point decides the answer');
});

test('the paste people actually make — code plus locality — still works', () => {
  const got = decodePlusCode(`${FULL}, ວຽງຈັນ, ລາວ`);
  assert.ok(got, 'Maps copies the locality along with the code');
  assert.ok(Math.abs(got.lat - VTE.lat) < 0.001);
});

test('lower case and stray spaces are tolerated', () => {
  const got = decodePlusCode(`  ${FULL.toLowerCase()}  `);
  assert.ok(got);
  assert.ok(Math.abs(got.lng - VTE.lng) < 0.001);
});

test('rubbish is null, never an exception and never a location', () => {
  for (const bad of ['', '   ', null, undefined, 'garbage', '17.9757,102.6331', '+++', 42, {}]) {
    assert.equal(decodePlusCode(bad), null, `${JSON.stringify(bad)} produced a location`);
    assert.equal(isShortPlusCode(bad), false);
  }
});

test('encoding refuses impossible positions rather than wrapping them', () => {
  assert.equal(encodePlusCode(null, null), null);
  assert.equal(encodePlusCode('', ''), null);
  assert.equal(encodePlusCode(91, 0), null);
  assert.equal(encodePlusCode(0, 181), null);
  assert.ok(encodePlusCode(0, 0), 'null island is a real place');
});

// ─── what the branch form saves ───────────────────────────────────────────────

test('with no Plus Code, the typed coordinates are saved unchanged', () => {
  const got = resolveBranchPosition({ lat: '17.9757', lng: '102.6331' });
  assert.deepEqual(got, { lat: 17.9757, lng: 102.6331, error: null });
});

test('blank coordinates stay absent — 0,0 is not "no location"', () => {
  // Number('') is 0, not NaN, so a blank field can slip through as a position
  // in the Gulf of Guinea. findNearestBranch treats that as a real branch.
  assert.deepEqual(resolveBranchPosition({ lat: '', lng: '' }), { lat: null, lng: null, error: null });
  assert.deepEqual(resolveBranchPosition({}), { lat: null, lng: null, error: null });
});

test('a Plus Code overrides whatever is in the coordinate boxes', () => {
  // The browser fills those boxes from the code; re-deciding on the server is
  // what makes the rule on the form ("leave Plus Code empty to type your own")
  // the same rule the database gets.
  const got = resolveBranchPosition({ plus_code: FULL, lat: '0', lng: '0' });
  assert.equal(got.error, null);
  assert.ok(Math.abs(got.lat - VTE.lat) < 0.001, 'the pasted code must win');
});

test('a short code uses the branch it belongs to as its reference', () => {
  const short = FULL.slice(4);
  const got = resolveBranchPosition({ plus_code: short }, { lat: VTE.lat, lng: VTE.lng });
  assert.equal(got.error, null);
  assert.ok(Math.abs(got.lat - VTE.lat) < 0.01);
});

test('a short code on a brand new branch is rejected with a way forward', () => {
  const got = resolveBranchPosition({ plus_code: 'JJXX+HR8' });
  assert.ok(got.error, 'must not save a guessed position');
  assert.match(got.error, /7P94XJGM\+76/, 'tell staff what a full code looks like');
});

test('a rejected code never half-saves a position', () => {
  const got = resolveBranchPosition({ plus_code: 'garbage', lat: '17.9', lng: '102.6' });
  assert.ok(got.error);
  // The submit is refused as a whole, so the caller must see an error rather
  // than a plausible position it would happily write.
  assert.match(got.error, /Plus Code/);
});

test('both branch forms refuse a bad code instead of saving it', () => {
  const CONTROLLER = readFileSync(new URL('../../src/controllers/branchesController.js', import.meta.url), 'utf8');
  const uses = CONTROLLER.match(/if \(position\.error\) errors\.push\(position\.error\)/g) || [];
  assert.equal(uses.length, 2, 'create and update must both reject, not just one');
  assert.ok(!/lat \? Number\(lat\) : null/.test(CONTROLLER), 'no path may bypass the resolver');
});

// ─── the form ─────────────────────────────────────────────────────────────────

test('the coordinate fields stay visible and editable', () => {
  // Plus Code is an easier way in, not a replacement: staff must be able to see
  // what a code decoded to, and correct it, before saving.
  const html = render({ lat: 17.9757, lng: 102.6331 });
  assert.match(html, /name="lat"[^>]*value="17\.9757"/);
  assert.match(html, /name="lng"[^>]*value="102\.6331"/);
  assert.ok(!/readonly/.test(html), 'the decoded position must remain correctable');
});

test('the decode preview links to a map before anything is saved', () => {
  // A wrong Plus Code looks exactly like a right one. The only real check is
  // seeing the pin, so the confirmation step has to be one tap away.
  assert.match(PARTIAL, /google\.com\/maps\/search/);
  assert.match(PARTIAL, /ตรวจบนแผนที่ก่อนบันทึก/);
});

test('a rejected code is handed back so it can be corrected', () => {
  assert.match(render({ code: 'JJXX+HR8' }), /name="plus_code"[^>]*value="JJXX\+HR8"/);
  assert.ok(!/value="JJXX/.test(render()), 'nothing to hand back on a fresh form');
});

test('the stored position is shown as a Plus Code for checking', () => {
  const html = render({ lat: VTE.lat, lng: VTE.lng, plusCode: FULL });
  assert.ok(html.includes(FULL));
  assert.ok(!render({ lat: '', lng: '' }).includes('พิกัดที่บันทึกไว้'), 'nothing to show without a position');
});

test('the field writes through an input event, not just .value', () => {
  // The create form binds its inputs to Alpine. Assigning .value alone leaves
  // the framework holding the old number, so the branch saves the wrong place.
  assert.match(PARTIAL, /dispatchEvent\(new Event\('input'/);
});

test('the decode endpoint is staff-only', () => {
  assert.match(ROUTES, /router\.get\('\/api\/plus-code\/decode', requireLogin, branches\.plusCodeApi\)/);
});

test('both forms use the one field, so they cannot drift apart', () => {
  for (const [name, view] of [['new', NEW], ['edit', EDIT]]) {
    assert.match(view, /include\('_plus_code'/, `${name}.ejs must use the shared field`);
    assert.ok(!/name="lat"/.test(view), `${name}.ejs still has its own coordinate input`);
  }
});

test('nothing left behind references the removed Alpine coordinates', () => {
  // The create form's preview panel was bound to x-model="lat"; deleting the
  // binding without deleting the readers would throw on every page load.
  assert.ok(!/x-model="lat"|x-text="lat"|x-show="lat/.test(NEW));
});
