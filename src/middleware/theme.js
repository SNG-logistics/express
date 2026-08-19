/**
 * src/middleware/theme.js
 *
 * Public portal light/dark toggle — same query-param-sets-session shape as
 * i18nMiddleware. Light is the customer-portal default for a brand-new
 * visitor; dark is the staff-side default (moot there — the admin UI is
 * always dark and never reads res.locals.theme).
 *
 * Usage in views:
 *   <html data-theme="<%= theme %>">
 *   <a href="?theme=<%= otherTheme %>">
 */

const SUPPORTED = ['dark', 'light'];
const DEFAULT_THEME = 'dark';

export function themeMiddleware(req, res, next) {
  let theme = req.query.theme || req.session?.theme;

  if (req.query.theme && SUPPORTED.includes(req.query.theme)) {
    theme = req.query.theme;
    if (req.session) req.session.theme = theme;
  }

  if (!theme || !SUPPORTED.includes(theme)) {
    // A brand-new visitor (no ?theme=, no session yet) gets light on the
    // customer portal; dark stays the staff-side default (and is moot there
    // anyway — the admin UI never reads res.locals.theme).
    theme = res.locals.isMemberSubdomain ? 'light' : DEFAULT_THEME;
  }

  res.locals.theme = theme;
  res.locals.otherTheme = theme === 'dark' ? 'light' : 'dark';
  next();
}
