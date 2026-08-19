import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import ejs from 'ejs';
import { canPublish } from '../../src/services/testimonialsService.js';

const MIGRATION = readFileSync(new URL('../../database/migrate_044_testimonials.sql', import.meta.url), 'utf8');
const SERVICE = readFileSync(new URL('../../src/services/testimonialsService.js', import.meta.url), 'utf8');
const PARTIAL = readFileSync(new URL('../../views/customer/_testimonials.ejs', import.meta.url), 'utf8');
const th = JSON.parse(readFileSync(new URL('../../src/i18n/th.json', import.meta.url)));
const lo = JSON.parse(readFileSync(new URL('../../src/i18n/lo.json', import.meta.url)));

const t = dict => key => key.split('.').reduce((o, p) => o?.[p], dict) ?? key;
const render = (testimonials, dict = th) => ejs.render(PARTIAL, { testimonials, t: t(dict) });

test('nothing is invented — the migration ships no rows at all', () => {
  // There are no completed purchase-agent orders yet. A seeded testimonial
  // would be a lie told on the page whose whole job is to establish honesty.
  assert.doesNotMatch(MIGRATION, /INSERT\s+INTO\s+testimonials/i);
});

test('the public query demands consent as well as publication', () => {
  // Two independent gates: a mis-click on status alone cannot expose someone
  // who never agreed to appear.
  const publicQuery = SERVICE.slice(SERVICE.indexOf('getPublishedTestimonials'));
  assert.match(publicQuery, /status\s*=\s*'published'/);
  assert.match(publicQuery, /consent_given\s*=\s*1/);
});

test('a row is publishable only once consent is recorded', () => {
  assert.equal(canPublish({ consent_given: 1, display_name: 'ນ້ອຍ' }), true);
  assert.equal(canPublish({ consent_given: 0, display_name: 'ນ້ອຍ' }), false);
  assert.equal(canPublish({ consent_given: 1, display_name: '   ' }), false);
  assert.equal(canPublish(null), false);
});

test('the panel disappears entirely when there is no real proof yet', () => {
  // An empty "what customers say" box is worse than none — it advertises that
  // nobody has used this.
  assert.equal(render([]).trim(), '');
  assert.equal(ejs.render(PARTIAL, { t: t(th) }).trim(), '');
});

test('a photo, a quote, or both — each renders on its own', () => {
  const photoOnly = render([{ id: 1, name: 'ນ້ອຍ', message: null, photo: '/uploads/testimonials/a.jpg' }]);
  assert.ok(photoOnly.includes('/uploads/testimonials/a.jpg'));
  assert.ok(photoOnly.includes('ນ້ອຍ'));

  const quoteOnly = render([{ id: 2, name: 'ສົມສັກ', message: 'ຂອງຮອດໄວດີ', photo: null }]);
  assert.ok(quoteOnly.includes('ຂອງຮອດໄວດີ'));
  assert.ok(!quoteOnly.includes('<img'), 'no empty image frame when there is no photo');
});

test('nothing identifying reaches the page', () => {
  // The service returns only display fields; the partial must not be able to
  // print an order reference or consent trail even if handed one.
  const html = render([{
    id: 3, name: 'ນ້ອຍ', message: 'ດີຫຼາຍ', photo: null,
    source_ref: 'SNG-260818-7561', consent_note: 'asked on WhatsApp', display_name: 'Full Name Here',
  }]);
  assert.ok(!html.includes('SNG-260818-7561'), 'order reference leaked');
  assert.ok(!html.includes('asked on WhatsApp'), 'consent trail leaked');
});

test('photos are lazy and captioned for anyone who cannot see them', () => {
  const html = render([{ id: 4, name: 'ນ້ອຍ', message: null, photo: '/uploads/testimonials/b.jpg' }]);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /alt="[^"]+"/);
});

test('the panel is worded in both languages', () => {
  assert.deepEqual(Object.keys(th.proof).sort(), Object.keys(lo.proof).sort());
  const html = render([{ id: 5, name: 'ນ້ອຍ', message: null, photo: null }], lo);
  assert.ok(!/proof\.[a-zA-Z]/.test(html), 'untranslated key leaked into the page');
});
