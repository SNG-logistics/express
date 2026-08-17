import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';
import { toWaPhone } from '../../src/utils/waPhone.js';

test('selected member country code normalizes Thai and Lao local numbers explicitly', () => {
  assert.equal(toWaPhone('0812345678', '66'), '66812345678');
  assert.equal(toWaPhone('02012345678', '856'), '8562012345678');
  assert.equal(toWaPhone('+66 81 234 5678', '66'), '66812345678');
  assert.equal(toWaPhone('+856 20 1234 5678', '856'), '8562012345678');
});

test('selected country rejects a number already prefixed for the other country', () => {
  assert.equal(toWaPhone('+856 20 1234 5678', '66'), null);
  assert.equal(toWaPhone('+66 81 234 5678', '856'), null);
  assert.equal(toWaPhone('0812345678', '999'), null);
  assert.equal(toWaPhone('0812345678', ''), null);
});

test('member login provides explicit Thai and Lao country choices', async () => {
  const template = await readFile(
    new URL('../../views/customer/member/login.ejs', import.meta.url),
    'utf8'
  );

  assert.match(template, /name="country_code"/);
  assert.match(template, /data-country-flag/);
  assert.match(template, />TH \+66</);
  assert.match(template, />LA \+856</);
  assert.doesNotMatch(template, /🇹🇭|🇱🇦/);
  assert.match(template, /autocomplete="tel-national"/);
  assert.match(template, /data-phone-input/);

  const render = (countryCode) => ejs.render(template, {
    t: () => 'Login',
    error: null,
    csrfToken: 'test-token',
    values: { country_code: countryCode, phone: '' },
  });
  assert.match(render('66'), /<option value="66"\s+selected\s*>/);
  assert.match(render('856'), /<option value="856"\s+selected\s*>/);
  assert.match(render('856'), /class="country-flag is-laos"/);
  assert.match(render('66'), /placeholder="09xxxxxxxx"/);
  assert.match(render('856'), /placeholder="020xxxxxxxx"/);
});

test('member registration provides the same explicit country choices', async () => {
  const template = await readFile(
    new URL('../../views/customer/member/register.ejs', import.meta.url),
    'utf8'
  );
  const render = (countryCode) => ejs.render(template, {
    t: () => 'Register',
    error: null,
    csrfToken: 'test-token',
    values: { country_code: countryCode, phone: '' },
  });

  assert.match(template, /name="country_code"/);
  assert.match(template, /data-country-flag/);
  assert.match(template, />TH \+66</);
  assert.match(template, />LA \+856</);
  assert.doesNotMatch(template, /🇹🇭|🇱🇦/);
  assert.match(template, /data-phone-input/);
  assert.match(render('66'), /<option value="66"\s+selected\s*>/);
  assert.match(render('856'), /<option value="856"\s+selected\s*>/);
  assert.match(render('856'), /class="country-flag is-laos"/);
  assert.match(render('66'), /placeholder="09xxxxxxxx"/);
  assert.match(render('856'), /placeholder="020xxxxxxxx"/);
});

test('country flag is a CSS graphic that follows the selected country', async () => {
  const [layout, styles] = await Promise.all([
    readFile(new URL('../../views/customer/layout.ejs', import.meta.url), 'utf8'),
    readFile(new URL('../../public/css/portal.css', import.meta.url), 'utf8'),
  ]);

  assert.match(layout, /select\.addEventListener\('change', update\)/);
  assert.match(layout, /classList\.toggle\('is-laos', select\.value === '856'\)/);
  assert.match(styles, /\.country-flag\.is-laos/);
  assert.match(styles, /\.country-flag\.is-laos::after/);
});

test('layout script switches the phone placeholder with the selected country', async () => {
  const layout = await readFile(new URL('../../views/customer/layout.ejs', import.meta.url), 'utf8');
  assert.match(layout, /data-phone-input/);
  assert.match(layout, /'66': '09xxxxxxxx', '856': '020xxxxxxxx'/);
  assert.match(layout, /phoneInput\.placeholder = placeholders\[select\.value\]/);
});
