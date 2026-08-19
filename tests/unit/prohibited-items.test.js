import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import ejs from 'ejs';

const SEED_SQL = readFileSync(new URL('../../database/migrate_043_prohibited_items.sql', import.meta.url), 'utf8');
const PARTIAL = readFileSync(new URL('../../views/customer/_prohibited.ejs', import.meta.url), 'utf8');
const th = JSON.parse(readFileSync(new URL('../../src/i18n/th.json', import.meta.url)));
const lo = JSON.parse(readFileSync(new URL('../../src/i18n/lo.json', import.meta.url)));

const t = dict => key => key.split('.').reduce((o, p) => o?.[p], dict) ?? key;

function render(prohibited, dict = th) {
  return ejs.render(PARTIAL, { prohibited, t: t(dict) });
}

test('the seed only fills an empty table, so a corrected list is never overwritten', () => {
  // Re-running migrations must not resurrect rows the owner deleted or undo
  // wording they fixed — customs corrections are the whole point of this table.
  assert.match(SEED_SQL, /WHERE NOT EXISTS \(SELECT 1 FROM prohibited_items/);
});

test('the seed ships both categories, in both languages', () => {
  assert.match(SEED_SQL, /'BANNED'/);
  assert.match(SEED_SQL, /'ASK_FIRST'/);
  // Lao text present — a Lao-reading customer must never meet a blank where a
  // restriction should be.
  assert.match(SEED_SQL, /[຀-໿]/);
});

test('both lists render, each labelled with what it means', () => {
  const html = render({
    banned: [{ label: 'ยาเสพติด', note: null }],
    askFirst: [{ label: 'แบตเตอรี่ลิเธียม', note: 'มีข้อจำกัดเรื่องขนาด' }],
  });

  assert.ok(html.includes('ยาเสพติด'));
  assert.ok(html.includes('แบตเตอรี่ลิเธียม'));
  assert.ok(html.includes('มีข้อจำกัดเรื่องขนาด'), 'the condition explains itself');
  assert.ok(html.includes(th.prohibited.bannedTitle));
  assert.ok(html.includes(th.prohibited.askTitle));
});

test('the consequence is stated, not implied', () => {
  // A purchase-agent customer has already paid a deposit, so "it may be seized
  // and the money may not come back" is the part that changes behaviour.
  const html = render({ banned: [{ label: 'ยาเสพติด', note: null }], askFirst: [] });
  assert.ok(html.includes(th.prohibited.whyMatters));
});

test('an empty list renders nothing at all rather than an empty box', () => {
  assert.equal(render({ banned: [], askFirst: [] }).trim(), '');
});

test('a missing list never breaks the page it sits on', () => {
  // getProhibitedItems swallows database failures and returns empty lists; the
  // partial has to survive being handed nothing at all too.
  assert.equal(ejs.render(PARTIAL, { t: t(th) }).trim(), '');
});

test('one category alone is fine — the other section simply does not appear', () => {
  const bannedOnly = render({ banned: [{ label: 'อาวุธ', note: null }], askFirst: [] });
  assert.ok(bannedOnly.includes(th.prohibited.bannedTitle));
  assert.ok(!bannedOnly.includes(th.prohibited.askTitle));
});

test('every phrase on this panel exists in Lao as well as Thai', () => {
  assert.deepEqual(Object.keys(th.prohibited).sort(), Object.keys(lo.prohibited).sort());
  const html = render({ banned: [{ label: 'ອາວຸດ', note: null }], askFirst: [] }, lo);
  assert.ok(!/prohibited\.[a-zA-Z]/.test(html), 'untranslated key leaked into the page');
});
