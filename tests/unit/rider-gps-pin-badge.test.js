import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

const RIDER  = readFileSync(new URL('../../src/controllers/riderController.js', import.meta.url), 'utf8');
const INDEX  = readFileSync(new URL('../../views/rider/index.ejs', import.meta.url), 'utf8');

// The WhatsApp-pin -> customers.lat/lng -> orders.receiver_lat/lng pipeline
// (receiverLocationService.js) already writes real coordinates onto in-flight
// orders; the job-detail screen (views/rider/job.ejs) already uses them for
// real map directions. The gap was narrower: the list screens never showed
// whether a pin existed at all, and the offers query didn't even select it.

test('getAvailableOffers now selects the coordinates', () => {
  const fn = RIDER.slice(RIDER.indexOf('async function getAvailableOffers'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.match(body, /o\.receiver_lat AS dest_lat, o\.receiver_lng AS dest_lng/);
});

test('the coordinate column flows to both consumers of getAvailableOffers', () => {
  // myJobs's initial `offers` prop and availableOffersApi's JSON both call
  // this same function — one query change must cover both.
  const callSites = [...RIDER.matchAll(/getAvailableOffers\(/g)];
  assert.ok(callSites.length >= 3, 'expected the definition plus at least two call sites');
});

test('the my-jobs card shows a GPS badge only when a pin exists', () => {
  const loop = INDEX.slice(INDEX.indexOf('(jobs || []).forEach'), INDEX.indexOf('<% }) %>'));
  assert.match(loop, /if \(job\.dest_lat && job\.dest_lng\) \{/);
  assert.match(loop, /มีพิกัด GPS/);
});

test('the offers cardHtml() shows the same badge, gated the same way', () => {
  const fn = INDEX.slice(INDEX.indexOf('function cardHtml'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.match(body, /o\.dest_lat && o\.dest_lng/);
  assert.match(body, /มีพิกัด GPS/);
});

test('no badge markup exists outside the truthy-coordinate guard (no unconditional GPS claim)', () => {
  // A badge shown unconditionally would misinform a rider on the far more
  // common case (no pin yet) that a real location is available.
  const cardHtmlFn = INDEX.slice(INDEX.indexOf('function cardHtml'));
  const body = cardHtmlFn.slice(0, cardHtmlFn.indexOf('\n  }'));
  const badgeAt = body.indexOf('มีพิกัด GPS');
  const guardAt = body.indexOf('o.dest_lat && o.dest_lng');
  assert.ok(guardAt > -1 && guardAt < badgeAt, 'the guard must gate the badge, not just sit nearby');
});
