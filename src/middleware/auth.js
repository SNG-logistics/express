/**
 * src/middleware/auth.js
 *
 * Hardened authentication & authorization middleware.
 *
 * Security controls added:
 *  1. requireLogin          — redirect unauthenticated requests to /login
 *  2. requireRole(roles)    — flat-array role guard (fixes variadic bug)
 *  3. requireAnyRole        — alias with clearer semantics
 *  4. loginRateLimit        — in-memory sliding-window brute-force protector
 *                             (5 attempts / 15 min per IP)
 *  5. regenerateSession     — protects against session-fixation on login
 *
 * Role hierarchy (highest → lowest privilege):
 *   owner > admin > manager > finance/accounting > dispatcher
 *   > warehouse_th > warehouse_la > customs
 *   > branch_operator > rider > staff
 *
 * NOTE: `owner` (เจ้าของระบบ) is a wildcard superset — requireRole() below
 * short-circuits and allows it on every guarded route, so it does not need to
 * be listed in each ROLES_* group. `accounting` (บัญชี) is read-only for
 * financial/investor reporting and is only added to view-only groups.
 */

// ─── Brute-force: in-memory store (per IP) ────────────────────────────────────
// Structure: { ip → { count, firstAttempt } }
const loginAttempts = new Map();
const MAX_ATTEMPTS  = 5;
const WINDOW_MS     = 15 * 60 * 1000; // 15 minutes
const publicRequestWindows = new Map();

/** Lightweight per-IP sliding window for inexpensive public JSON endpoints. */
export function publicRateLimit({ max = 60, windowMs = WINDOW_MS } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (publicRequestWindows.get(ip) || []).filter(time => now - time < windowMs);
    if (recent.length >= max) {
      const retryAfterMs = windowMs - (now - recent[0]);
      res.set('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      return res.status(429).json({ error: 'Too many requests', retryAfterMs });
    }
    recent.push(now);
    publicRequestWindows.set(ip, recent);
    next();
  };
}

/** Clean up expired windows (called on each attempt) */
function pruneLoginAttempts() {
  const now = Date.now();
  for (const [ip, record] of loginAttempts) {
    if (now - record.firstAttempt > WINDOW_MS) loginAttempts.delete(ip);
  }
}

/**
 * Middleware — block request if IP has exceeded MAX_ATTEMPTS in the window.
 * Call BEFORE the bcrypt comparison so we don't waste CPU on locked IPs.
 */
export function loginRateLimit(req, res, next) {
  pruneLoginAttempts();
  const ip  = req.ip || req.socket?.remoteAddress || 'unknown';
  const rec = loginAttempts.get(ip);

  if (rec && rec.count >= MAX_ATTEMPTS) {
    const waitMin = Math.ceil((WINDOW_MS - (Date.now() - rec.firstAttempt)) / 60000);
    return res.render('auth/login', {
      flash: { type: 'error', message: `ผิดรหัสผ่านเกินกำหนด — กรุณารอ ${waitMin} นาทีแล้วลองใหม่` },
      title: 'เข้าสู่ระบบ',
    });
  }
  next();
}

/**
 * Call after a FAILED login attempt to increment the counter.
 * Call with success=true after a SUCCESSFUL login to clear it.
 */
export function recordLoginAttempt(ip, success) {
  if (success) {
    loginAttempts.delete(ip);
    return;
  }
  pruneLoginAttempts();
  const rec = loginAttempts.get(ip);
  if (rec) {
    rec.count++;
  } else {
    loginAttempts.set(ip, { count: 1, firstAttempt: Date.now() });
  }
}

// ─── requireLogin ─────────────────────────────────────────────────────────────

export function requireLogin(req, res, next) {
  if (req.session?.user) return next();
  // Store intended URL for post-login redirect (GET only)
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  return res.redirect('/login');
}

// ─── requireRole ─────────────────────────────────────────────────────────────
/**
 * requireRole(['admin','manager']) — accepts an array OR spreaded args.
 * Renders 403 with a user-friendly page instead of raw string.
 *
 * @param {string|string[]} roles
 */
export const ROLE_ALIASES = Object.freeze({
  thai_warehouse: 'warehouse_th',
  lao_warehouse: 'warehouse_la',
});

export function normalizeRole(role) {
  return ROLE_ALIASES[role] || role;
}

export function requireRole(...roleArgs) {
  // Accept requireRole('admin', 'manager') and requireRole(['admin','manager']).
  const allowed = roleArgs.flat(Infinity).map(normalizeRole);

  return (req, res, next) => {
    const user = req.session?.user;
    if (!user) return res.redirect('/login');
    // owner = system owner: wildcard access to every guarded route.
    if (normalizeRole(user.role) === 'owner') return next();
    if (allowed.includes(normalizeRole(user.role))) return next();

    // Log denied access attempts for security audit
    console.warn(
      `[AUTH] Access denied — user=${user.username} role=${user.role} ` +
      `needed=${allowed.join('|')} path=${req.originalUrl}`
    );
    return res.status(403).render('errors/403', {
      user,
      title: 'ไม่มีสิทธิ์เข้าถึง',
      requiredRoles: allowed,
    });
  };
}

/** Alias for readability */
export const requireAnyRole = requireRole;

// ─── ROLE GROUPS (reusable sets) ─────────────────────────────────────────────
/** Only admins may create/deactivate users */
export const ROLES_ADMIN_ONLY    = ['admin'];
/** Admins + managers may manage business config */
export const ROLES_MANAGE        = ['admin', 'manager'];
/** All finance-sensitive WRITE actions (remit COD, settle trip, etc.) */
export const ROLES_FINANCE       = ['admin', 'manager', 'finance'];
/** Read-only financial visibility — includes accounting (investor reporting) */
export const ROLES_FINANCE_VIEW  = ['admin', 'manager', 'finance', 'accounting'];
/** Customs clearance actions */
export const ROLES_CUSTOMS       = ['admin', 'manager', 'customs'];
/** Any warehouse-facing role */
export const ROLES_WAREHOUSE     = ['admin', 'manager', 'dispatcher', 'warehouse_th', 'warehouse_la'];
/** Order creation + basic edits */
export const ROLES_ORDER_WRITE   = ['admin', 'manager', 'dispatcher', 'warehouse_th', 'warehouse_la', 'staff'];
/** Scanner / quick status update — drivers can also scan */
export const ROLES_SCANNER       = ['admin', 'manager', 'dispatcher', 'warehouse_th', 'warehouse_la', 'branch_operator', 'driver_support'];

/** Delivery field actions — dispatcher + driver can start/complete delivery */
export const ROLES_DELIVERY_WRITE = ['admin', 'manager', 'dispatcher', 'driver_support', 'branch_operator'];
/** COD collection in the field (driver can collect COD at door) */
export const ROLES_COD_COLLECT   = ['admin', 'manager', 'finance', 'dispatcher', 'driver_support'];
/** COD remittance (financial closure) */
export const ROLES_COD_REMIT     = ['admin', 'manager', 'finance'];
/** Order CLOSE — irreversible */
export const ROLES_CLOSE_ORDER   = ['admin', 'manager'];
/** Order RETURN — destructive business action */
export const ROLES_RETURN_ORDER  = ['admin', 'manager', 'dispatcher'];
/** Customer service — read-only order tracking & customer lookup */
export const ROLES_CUSTOMER_SERVICE = ['admin', 'manager', 'customer_service'];
/** Read-only dashboard (all operational roles) */
export const ROLES_READ          = [
  'admin', 'manager', 'finance', 'dispatcher',
  'warehouse_th', 'warehouse_la', 'customs', 'staff',
  'branch_operator', 'customer_service', 'driver_support',
];
/** Rider — last-mile delivery only */
export const ROLES_RIDER         = ['rider'];
/** Assign rider — admin, manager, warehouse_la can assign */
export const ROLES_RIDER_ASSIGN  = ['admin', 'manager', 'warehouse_la', 'warehouse_th'];

export const OPERATIONAL_ROLES = Object.freeze([
  'owner', 'admin', 'manager', 'staff', 'dispatcher', 'finance', 'accounting',
  'customs', 'warehouse_th', 'warehouse_la', 'branch_operator', 'customer_service',
  'driver_support', 'rider',
]);

export const CRM_ROLES = Object.freeze([
  'crm_admin', 'crm_supervisor', 'crm_agent', 'sales_agent',
  'logistics_support', 'finance_support',
]);

// ─── CRM Role Groups ──────────────────────────────────────────────────────────
/** CRM Admin — full CRM access, all teams, all conversations, settings */
export const ROLES_CRM_ADMIN      = ['admin', 'crm_admin'];
/** CRM Supervisor — view all conversations in own team, assign/reassign, SLA */
export const ROLES_CRM_SUPERVISOR = ['admin', 'crm_admin', 'crm_supervisor'];
/** Any CRM agent role — can access inbox, reply, add notes, manage own queue */
export const ROLES_CRM_AGENT      = [
  'admin', 'crm_admin', 'crm_supervisor', 'crm_agent',
  'sales_agent', 'logistics_support', 'finance_support',
];
/** All staff allowed to VIEW CRM (including legacy manager) */
export const ROLES_CRM_VIEW       = [
  'admin', 'manager', 'crm_admin', 'crm_supervisor', 'crm_agent',
  'sales_agent', 'logistics_support', 'finance_support',
];

// ─── Session Fixation Protection ─────────────────────────────────────────────
/**
 * Regenerate session ID after login to prevent session-fixation attacks.
 * Preserves flash + returnTo from old session.
 */
export function regenerateSession(req, newUserPayload, callback) {
  const returnTo = req.session.returnTo;
  const flash    = req.session.flash;
  const customer = req.session.customer;

  req.session.regenerate((err) => {
    if (err) return callback(err);
    req.session.user     = newUserPayload;
    req.session.returnTo = returnTo;
    req.session.flash    = flash;
    if (customer) req.session.customer = customer;
    req.session.save(callback);
  });
}
