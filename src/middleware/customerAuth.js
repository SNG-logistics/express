/**
 * src/middleware/customerAuth.js
 *
 * Authentication & session isolation middleware for customer accounts.
 * Operates on req.session.customer independently of staff req.session.user.
 */

/**
 * Gate route for logged-in customer accounts.
 */
export function requireCustomerLogin(req, res, next) {
  if (req.session?.customer) return next();
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  return res.redirect('/member/login');
}

// ─── Brute-force protection for /member/login ────────────────────────────────
// Independent counter from staff loginRateLimit (src/middleware/auth.js) —
// customer auth is deliberately kept isolated from staff auth end to end.
const memberLoginAttempts = new Map();
const MEMBER_MAX_ATTEMPTS = 5;
const MEMBER_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function pruneMemberLoginAttempts() {
  const now = Date.now();
  for (const [ip, record] of memberLoginAttempts) {
    if (now - record.firstAttempt > MEMBER_WINDOW_MS) memberLoginAttempts.delete(ip);
  }
}

/** Call BEFORE the bcrypt comparison so we don't waste CPU on locked IPs. */
export function memberLoginRateLimit(req, res, next) {
  pruneMemberLoginAttempts();
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const rec = memberLoginAttempts.get(ip);

  if (rec && rec.count >= MEMBER_MAX_ATTEMPTS) {
    const waitMin = Math.ceil((MEMBER_WINDOW_MS - (Date.now() - rec.firstAttempt)) / 60000);
    return res.render('member/login', {
      layout: 'layouts/public',
      title: `${res.locals.t('portal.login')} | SNG Express`,
      values: {},
      error: `เข้าสู่ระบบผิดเกินกำหนด — กรุณารอ ${waitMin} นาทีแล้วลองใหม่`,
    });
  }
  next();
}

/** Call after every /member/login attempt (success clears the counter). */
export function recordMemberLoginAttempt(ip, success) {
  if (success) {
    memberLoginAttempts.delete(ip);
    return;
  }
  pruneMemberLoginAttempts();
  const rec = memberLoginAttempts.get(ip);
  if (rec) {
    rec.count++;
  } else {
    memberLoginAttempts.set(ip, { count: 1, firstAttempt: Date.now() });
  }
}

/**
 * Regenerate session ID after customer login / registration to prevent fixation attacks.
 * Preserves staff session (req.session.user), returnTo, and flash.
 */
export function regenerateCustomerSession(req, newCustomerPayload, callback) {
  const returnTo = req.session.returnTo;
  const flash    = req.session.flash;
  const user     = req.session.user;

  req.session.regenerate((err) => {
    if (err) return callback(err);
    req.session.customer = newCustomerPayload;
    req.session.returnTo = returnTo;
    req.session.flash    = flash;
    if (user) req.session.user = user;
    req.session.save(callback);
  });
}
