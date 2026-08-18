import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

const [profileView, controller, portalCss, thJson, loJson] = await Promise.all([
  readFile(new URL('../../views/customer/member/profile.ejs', import.meta.url), 'utf8'),
  readFile(new URL('../../src/controllers/memberController.js', import.meta.url), 'utf8'),
  readFile(new URL('../../public/css/portal.css', import.meta.url), 'utf8'),
  readFile(new URL('../../src/i18n/th.json', import.meta.url), 'utf8'),
  readFile(new URL('../../src/i18n/lo.json', import.meta.url), 'utf8'),
]);

const th = JSON.parse(thJson);
const lo = JSON.parse(loJson);

function translator(dict) {
  return (key) => key.split('.').reduce((value, part) => value?.[part], dict) ?? key;
}

function render({
  dict = th,
  lang = 'th',
  referralCreditLak = 40000,
  latestOrder = null,
  latestOrderUnavailable = false,
  referralCode = 'SNG-AB12',
} = {}) {
  return ejs.render(profileView, {
    t: translator(dict),
    lang,
    account: {
      first_name: lang === 'lo' ? 'ສົມໃຈ' : 'สมใจ',
      phone: '8562055551288',
      phone_display: '020 5555 1288',
      referral_code: referralCode,
    },
    referralCreditLak,
    latestOrder,
    latestOrderUnavailable,
  });
}

test('member profile renders a real latest shipment with localized status and safe tracking URL', () => {
  const html = render({
    latestOrder: {
      id: 41,
      job_no: 'SNG/260818-041',
      direction: 'TH_TO_LA',
      status: 'AT_DEST_WH',
      receiver_city: 'เวียงจันทน์',
      delivered_at: null,
    },
  });

  assert.match(html, /สวัสดี, สมใจ/);
  assert.match(html, /ยืนยันตัวตนแล้ว/);
  assert.match(html, /ถึงคลังปลายทาง/);
  assert.match(html, /href="\/track\/SNG%2F260818-041"/);
  assert.match(html, /40,000/);
  assert.match(html, /member-order-progress/);
  assert.match(html, /aria-label="ค้นหา"/);
});

test('a non-delivered CLOSED order does not imply successful progress', () => {
  const closedWithoutDelivery = render({
    latestOrder: {
      id: 12,
      job_no: 'SNG-CLOSED-012',
      direction: 'TH_TO_LA',
      status: 'CLOSED',
      receiver_city: 'เวียงจันทน์',
      delivered_at: null,
    },
  });
  const closedAfterDelivery = render({
    latestOrder: {
      id: 13,
      job_no: 'SNG-CLOSED-013',
      direction: 'TH_TO_LA',
      status: 'CLOSED',
      receiver_city: 'เวียงจันทน์',
      delivered_at: '2026-08-18T00:00:00.000Z',
    },
  });

  assert.doesNotMatch(closedWithoutDelivery, /member-order-progress/);
  assert.match(closedWithoutDelivery, new RegExp(th.status.CLOSED));
  assert.match(closedAfterDelivery, /member-order-progress is-success/);
});

test('empty order state stays distinct from an order-query failure', () => {
  const emptyHtml = render();
  const unavailableHtml = render({ latestOrderUnavailable: true, referralCreditLak: null });

  assert.match(emptyHtml, new RegExp(th.member.noRecentOrder));
  assert.doesNotMatch(emptyHtml, new RegExp(th.member.orderUnavailable));
  assert.match(unavailableHtml, new RegExp(th.member.orderUnavailable));
  assert.doesNotMatch(unavailableHtml, new RegExp(th.member.noRecentOrder));
  assert.match(unavailableHtml, new RegExp(th.member.creditUnavailable));
  assert.doesNotMatch(unavailableHtml, />0\s*<\/strong>/);
});

test('Lao member profile localizes its UI, status, and credit amount', () => {
  const html = render({
    dict: lo,
    lang: 'lo',
    latestOrder: {
      id: 7,
      job_no: 'SNG-LO-007',
      direction: 'LA_TO_TH',
      status: 'DELIVERED',
      receiver_city: 'ອຸດອນທານີ',
      delivered_at: '2026-08-18T00:00:00.000Z',
    },
  });

  assert.match(html, new RegExp(lo.member.greeting));
  assert.match(html, new RegExp(lo.member.verified));
  assert.match(html, new RegExp(lo.member.latestOrder));
  assert.match(html, new RegExp(lo.status.DELIVERED));
  assert.match(html, /40\.000/);
  assert.doesNotMatch(html, /ยืนยันตัวตนแล้ว|พัสดุล่าสุด|ออกจากระบบ/);
});

test('member profile has no fake loyalty/order fallbacks or inline click handler', () => {
  assert.doesNotMatch(profileView, /SNG-XXXX|เร็วๆ นี้|member\.points|onclick=/);
  assert.doesNotMatch(profileView, /#[0-9a-f]{3,8}|linear-gradient/i);
  assert.match(portalCss, /\.member-dashboard/);
  assert.match(portalCss, /\[data-theme="light"\]/);
});

test('member dictionaries stay in key parity', () => {
  assert.deepEqual(Object.keys(th.member).sort(), Object.keys(lo.member).sort());
});

test('profile controller distinguishes unavailable data and picks the latest order deterministically', () => {
  assert.match(controller, /Promise\.allSettled/);
  assert.match(controller, /latestOrderUnavailable = true/);
  assert.match(controller, /ORDER BY o\.created_at DESC, o\.id DESC/);
  assert.match(controller, /resolveStatus\(order\.status\)/);
  assert.match(controller, /req\.session\.theme = 'light'/);
});
