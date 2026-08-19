/**
 * src/middleware/i18n.js
 * 
 * Simple i18n middleware — reads lang from query/session, loads JSON dict,
 * exposes t() helper and lang info to all EJS views.
 * 
 * Switch language: add ?lang=lo or ?lang=th to any URL
 * 
 * Usage in views:
 *   <%= t('nav.dashboard') %>
 *   <%= t('status.DELIVERED') %>
 *   <%= lang %>        → 'th' | 'lo'
 *   <%= langFlag %>    → '🇹🇭' | '🇱🇦'
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load dictionaries once at startup ────────────────────────────────────────
const LANGS = {};
for (const code of ['th', 'lo']) {
  const filePath = join(__dirname, '..', 'i18n', `${code}.json`);
  try {
    LANGS[code] = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`[i18n] Failed to load ${code}.json:`, err.message);
    LANGS[code] = {};
  }
}

// DEFAULT_LANG is the translation-fallback chain's anchor (used when a key
// is missing from the visitor's own dict) — stays Thai, the more complete
// dictionary, regardless of which side of the app is being served.
const DEFAULT_LANG = 'th';
const SUPPORTED = Object.keys(LANGS);

/**
 * Resolve a dotted key like 'nav.dashboard' from a dict object.
 */
function resolve(dict, key) {
  return key.split('.').reduce((obj, k) => obj?.[k], dict);
}

/**
 * Express middleware — sets res.locals: t, lang, langLabel, langFlag, otherLang
 */
export function i18nMiddleware(req, res, next) {
  // 1. Determine language: ?lang= query > session > default
  let lang = req.query.lang || req.session?.lang;

  // If ?lang= is set, save to session for persistence
  if (req.query.lang && SUPPORTED.includes(req.query.lang)) {
    lang = req.query.lang;
    if (req.session) req.session.lang = lang;
  }

  if (!lang || !SUPPORTED.includes(lang)) {
    // A brand-new visitor (no ?lang=, no session yet) gets Lao on the
    // customer portal and Thai on the staff side — res.locals.isMemberSubdomain
    // is set by the host-detection middleware mounted just above this one.
    lang = res.locals.isMemberSubdomain ? 'lo' : DEFAULT_LANG;
  }

  const dict     = LANGS[lang] || LANGS[DEFAULT_LANG];
  const fallback = LANGS[DEFAULT_LANG];

  // 2. t() function — lookup with fallback to Thai, then raw key
  const t = (key) => {
    return resolve(dict, key) ?? resolve(fallback, key) ?? key;
  };

  // 3. Expose to views
  res.locals.t         = t;
  res.locals.lang      = lang;
  res.locals.langLabel = dict._label || lang;
  res.locals.langFlag  = dict._flag || '';
  res.locals.otherLang = lang === 'th' ? 'lo' : 'th';
  res.locals.otherFlag = lang === 'th' ? '🇱🇦' : '🇹🇭';
  res.locals.otherLabel= lang === 'th' ? 'ລາວ' : 'ไทย';

  next();
}
