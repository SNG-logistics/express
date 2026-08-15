/**
 * src/middleware/theme.js
 *
 * Public portal light/dark toggle — same query-param-sets-session shape as
 * i18nMiddleware. Dark is the brand default; light is an explicit opt-in.
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
    theme = DEFAULT_THEME;
  }

  res.locals.theme = theme;
  res.locals.otherTheme = theme === 'dark' ? 'light' : 'dark';
  next();
}
