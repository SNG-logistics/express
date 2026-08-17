// NOTE: dotenv is loaded by src/config/db.js via 'import dotenv/config'
// which is evaluated before this file's code runs (ESM module hoisting).

import express from 'express';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import expressLayouts from 'express-ejs-layouts';
import csrf from 'csurf';

import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import orderRoutes from './routes/orders.js';
import scannerRoutes from './routes/scanner.js';
import tripRoutes from './routes/trips.js';
import customsRoutes from './routes/customs.js';
import codRoutes from './routes/cod.js';
import billingRoutes from './routes/billing.js';
import customersRoutes from './routes/customers.js';
import usersRoutes from './routes/users.js';
import branchRoutes from './routes/branches.js';
import dispatchRoutes from './routes/dispatch.js';
import whatsappRoutes from './routes/whatsapp.js'; // Enabled WhatsApp
import settingsRoutes from './routes/settings.js';
import partnerRoutes from './routes/partner.js';
import expensesRoutes from './routes/expenses.js';
import spaceBookingRoutes from './routes/spaceBooking.js';
import riderRoutes from './routes/rider.js';
import riderAdminRoutes from './routes/riders.js';
import crmRoutes from './routes/crm.js';           // ─ Omnichannel CRM
import webhookRoutes from './routes/webhooks.js';   // ─ FB + LINE webhooks (public)
import webhookSimRoutes from './routes/webhookSim.js'; // ─ Dev simulator (blocked in prod)
import { setIo } from './services/channelService.js'; // ─ Socket.io ref
import { startSlaChecker } from './services/automationService.js'; // ─ SLA engine
import { startNotificationWorker } from './services/notificationService.js';
import { createServer } from 'http';                // ─ Socket.io needs raw http server
import { Server as SocketIO } from 'socket.io';    // ─ Real-time CRM inbox
import * as tracking from './controllers/trackingController.js';
import * as publicController from './controllers/publicController.js';
import publicRoutes from './routes/public.js';
import memberRoutes from './routes/member.js';
import shopsDirectoryRoutes from './routes/shopsDirectory.js';

import { i18nMiddleware } from './middleware/i18n.js';
import { themeMiddleware } from './middleware/theme.js';
import pool from './config/db.js';

// ─── DB Init (idempotent table guard) ───────────────────────────────────────
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shipping_rates (
          id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
          name VARCHAR(100) NOT NULL,
          max_weight DECIMAL(10,2) NOT NULL,
          max_dimension INT NOT NULL DEFAULT 0 COMMENT 'Sum of W+L+H in cm',
          price DECIMAL(10,2) NOT NULL,
          active TINYINT(1) NOT NULL DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Guard: ensure cod_settlements.order_id has a UNIQUE key
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cod_settlements (
          id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
          order_id BIGINT UNSIGNED NOT NULL,
          cod_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
          collected_at TIMESTAMP NULL,
          remitted_at TIMESTAMP NULL,
          remitted_to VARCHAR(180),
          status ENUM('PENDING','COLLECTED','REMITTED') NOT NULL DEFAULT 'PENDING',
          note TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_cod_order_app FOREIGN KEY (order_id) REFERENCES orders(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Add UNIQUE KEY on cod_settlements.order_id if not already present
    const [indexes] = await pool.query(`
      SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cod_settlements'
        AND INDEX_NAME = 'uq_cod_order'
      LIMIT 1
    `);
    if (indexes.length === 0) {
      try {
        await pool.query(`ALTER TABLE cod_settlements ADD UNIQUE KEY uq_cod_order (order_id)`);
        console.log('[DB] Added UNIQUE KEY uq_cod_order on cod_settlements.');
      } catch (e) {
        // May fail if duplicate rows already exist — warn, do not crash
        console.warn('[DB] Could not add UNIQUE KEY on cod_settlements:', e.message);
      }
    }

    // Create exchange_rates table (THB <-> LAK)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS exchange_rates (
          id          INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
          pair        VARCHAR(10) NOT NULL DEFAULT 'THB_LAK' COMMENT 'e.g. THB_LAK',
          rate        DECIMAL(12,4) NOT NULL COMMENT 'How many LAK per 1 THB',
          set_by      INT UNSIGNED NULL,
          note        VARCHAR(255) NULL,
          created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Partner Quotation System
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partner_quotations (
          id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
          branch_id           INT UNSIGNED NULL,
          created_by          INT UNSIGNED NULL,
          quote_no            VARCHAR(30) NOT NULL,
          product_url         TEXT NULL,
          product_name        VARCHAR(500) NOT NULL,
          product_price_thb   DECIMAL(12,2) NOT NULL,
          shipping_th_thb     DECIMAL(10,2) NOT NULL DEFAULT 0,
          weight_kg           DECIMAL(8,2) NOT NULL DEFAULT 0,
          exchange_rate       DECIMAL(12,4) NOT NULL,
          fx_spread_pct       DECIMAL(5,2) NOT NULL DEFAULT 0,
          sng_shipping_lak    DECIMAL(12,2) NOT NULL DEFAULT 0,
          service_fee_lak     DECIMAL(12,2) NOT NULL DEFAULT 0,
          subtotal_thb        DECIMAL(12,2) NOT NULL DEFAULT 0,
          total_lak           DECIMAL(14,2) NOT NULL,
          customer_name       VARCHAR(200) NULL,
          customer_phone      VARCHAR(30) NULL,
          customer_address    TEXT NULL,
          status ENUM('draft','sent','accepted','ordered','cancelled') NOT NULL DEFAULT 'draft',
          note                TEXT NULL,
          order_id            BIGINT UNSIGNED NULL,
          created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at          TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_pq_branch (branch_id),
          KEY idx_pq_status (status),
          KEY idx_pq_quote_no (quote_no)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('[DB] initDb complete.');
  } catch (err) {
    console.error('[DB] initDb error:', err.message);
    // Do not crash startup — app may still work for most features
  }
}

// ─── App Setup ───────────────────────────────────────────────────────────────
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// ─── Force UTF-8 charset on all HTML responses ────────────────────────────────
app.use((_req, res, next) => {
  res.charset = 'utf-8';
  next();
});


// ─── Security Headers ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,  // EJS inline scripts; enable when migrating to external JS
  crossOriginEmbedderPolicy: false, // allow image loading
}));

// ─── Webhook routes FIRST (before body-parser consumes stream) ─────────────
// LINE/FB webhooks need raw body for signature verify — must be before express.json
app.use(webhookRoutes);

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));


const isProduction = process.env.NODE_ENV === 'production';

// Trust proxy for secure cookies behind Nginx/Plesk
app.set('trust proxy', 1);

// ─── Session Store (MySQL-backed, survives restarts) ────────────────────────
const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 900000, // 15 min
  expiration: 86400000,            // 1 day
  createDatabaseTable: true,
  schema: {
    tableName: 'sessions',
    columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' }
  }
}, pool);

// ─── Session Secret ─────────────────────────────────────────────────────────
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.startsWith('change_me')) {
  if (isProduction) {
    console.error('[FATAL] SESSION_SECRET is not set or is a placeholder. Refusing to start in production.');
    process.exit(1);
  }
  console.warn('[SECURITY] SESSION_SECRET is not configured — using insecure default for local dev only.');
}

const sessionMiddleware = session({
    store: sessionStore,
    secret: sessionSecret || 'dev_only_insecure_fallback_' + Date.now(),
    resave: false,
    saveUninitialized: false,
    name: 'sng.sid',  // non-default cookie name hides framework identity
    cookie: {
      secure: isProduction, // true on Production (HTTPS), false on Local
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
  });
app.use(sessionMiddleware);

// ─── i18n (Thai/Lao) ────────────────────────────────────────────────────────
app.use(i18nMiddleware);

// ─── Public portal light/dark theme toggle ───────────────────────────────────
app.use(themeMiddleware);

// ─── Member subdomain (member.<host>) — the whole customer portal lives here ─
// Point a member.<domain> DNS record + Plesk Domain Alias at this same app
// (no separate deploy needed) — everything below is host-based, not a second
// copy of the app. Goal: customer traffic (home/track/calculate/shops/member)
// and staff/admin traffic never share a host, so an old bookmark or typo on
// the wrong side gets bounced, not served.
//
// The main host's '/' bounces anonymous visitors to the customer subdomain
// too (handled in the app.get('/', ...) route below, not the bounce list
// here, since it needs the isMemberSubdomain branch as well) — staff sign in
// via /login directly instead of the bare root. Deliberate: the bare domain
// root shouldn't hand a login form to every random visitor or bot probing
// it. Everything else customer-shaped bounces away from the main host
// unconditionally (even for logged-in staff — they have their own internal
// tools for these), which is what actually keeps the two hosts separate
// instead of merely "separate when logged out."
// Paths that pass through unprefixed on the subdomain — includes '/', the
// customer home page, which IS a valid direct route there.
const CUSTOMER_DIRECT_PATHS = ['/', '/track', '/calculate', '/shops', '/api/public', '/member'];
// Same set minus '/' — used on the main host, where '/' gets its own
// host-aware handling below instead of a blind bounce (see app.get('/', ...)).
const MAIN_HOST_BOUNCE_PATHS = CUSTOMER_DIRECT_PATHS.filter(p => p !== '/');
const MEMBER_BARE_PATHS = [
  '/register', '/verify', '/verify/resend', '/login', '/logout', '/forgot-password', '/reset-password',
  '/profile', '/orders', '/account', '/quote-request', '/quote-requests',
];

function isCustomerDirectPath(path) {
  return CUSTOMER_DIRECT_PATHS.some(p => path === p || (p !== '/' && path.startsWith(p + '/')));
}

function shouldBounceFromMainHost(path) {
  return MAIN_HOST_BOUNCE_PATHS.some(p => path === p || path.startsWith(p + '/'));
}

app.use((req, res, next) => {
  const host = req.get('host') || '';
  const isMemberSubdomain = host.startsWith('member.');
  const mainHost = isMemberSubdomain ? host.slice('member.'.length) : host;
  const memberHost = isMemberSubdomain ? host : 'member.' + host;
  res.locals.isMemberSubdomain = isMemberSubdomain;
  res.locals.mainHost = mainHost;
  res.locals.memberHost = memberHost;

  if (isMemberSubdomain) {
    if (MEMBER_BARE_PATHS.includes(req.path)) {
      // /login, /register, /profile, ... → the real routes live under /member.
      req.url = '/member' + req.url;
    } else if (!isCustomerDirectPath(req.path)) {
      // Not a recognized customer path — could be a staff-only URL (e.g.
      // /dashboard) or just a bad link. Route to something nothing will ever
      // match so this falls through cleanly to the existing catch-all 404
      // (rendered once every res.locals is populated) instead of bouncing to
      // the main host — which would leak that a staff host exists — or, worse,
      // actually reaching a real staff route and inheriting its own redirects.
      req.url = '/__customer_not_found__';
    }
    // else: already a direct match (/, /track, /calculate, /shops, /member/*,
    // /api/public/*) — these routes work unprefixed, no rewrite needed.

    // memberController redirects (and requireCustomerLogin) hardcode
    // '/member/...' targets — strip that prefix on the way out so the
    // address bar stays on clean member.<host>/login-style URLs instead of
    // round-tripping through /member/login and staying there.
    const originalRedirect = res.redirect.bind(res);
    res.redirect = (statusOrUrl, maybeUrl) => {
      const hasStatus = typeof statusOrUrl === 'number';
      const status = hasStatus ? statusOrUrl : null;
      let url = hasStatus ? maybeUrl : statusOrUrl;
      if (typeof url === 'string' && url.startsWith('/member')) {
        url = url.slice('/member'.length) || '/';
      }
      return status ? originalRedirect(status, url) : originalRedirect(url);
    };
  } else if (shouldBounceFromMainHost(req.path)) {
    // Main host never serves customer-facing routes, staff session or not —
    // this is what makes the split real instead of just a logged-out default.
    // Covers old /track links already printed on shipping stickers too.
    return res.redirect(`//${memberHost}${req.originalUrl}`);
  }

  next();
});

// Paths that must NOT be CSRF-protected (JSON APIs / external webhooks)
const CSRF_SKIP = ['/webhooks/', '/dev/webhook-sim/send'];

app.use((req, res, next) => {
  const skip = CSRF_SKIP.some(prefix => req.path.startsWith(prefix));
  if (skip) return next();
  return csrf({
    value: (req) =>
      req.body?._csrf
      || req.query?._csrf
      || req.headers['x-csrf-token']
      || req.headers['x-xsrf-token'],
  })(req, res, next);
});


app.use((req, res, next) => {
  res.locals.csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : '';
  res.locals.flash = req.session.flash || null;
  res.locals.portalCurrentUser = req.session.customer || null;
  delete req.session.flash;
  next();
});

app.use((req, res, next) => {
  const user = req.session.user || null;
  const role = user?.role || null;
  res.locals.currentUser = user;
  res.locals.title = res.locals.title || 'sng logistics';

  // ── UI gating helpers ─────────────────────────────────────────────────
  // Available in every EJS template as `can.createOrder`, `can.viewCod`, etc.
  // owner = system owner: wildcard, true for every capability.
  const has = (...roles) => role !== null && (role === 'owner' || roles.includes(role));

  res.locals.currentPath = req.path;   // used by sidebar for active detection
  res.locals.userRole = role;
  res.locals.can = {
    // Orders — create/edit/write
    createOrder:       has('admin','manager','dispatcher','warehouse_th','warehouse_la','staff'),
    editOrder:         has('admin','manager','dispatcher'),
    closeOrder:        has('admin','manager'),
    returnOrder:       has('admin','manager','dispatcher'),
    addPayment:        has('admin','manager','finance','dispatcher'),
    deletePayment:     has('admin','manager','finance'),
    // Orders — delivery field actions
    markDelivered:     has('admin','manager','dispatcher','driver_support','branch_operator'),
    // Orders — read access (broader)
    viewOrder:         has('admin','manager','dispatcher','warehouse_th','warehouse_la',
                           'finance','customer_service','driver_support','branch_operator'),
    // Trips
    createTrip:        has('admin','manager','dispatcher'),
    closeTrip:         has('admin','manager'),
    cancelTrip:        has('admin'),  // ยกเลิกรอบรถ — admin สูงสุดเท่านั้น
    retroAttachOrder:  has('admin','manager'),  // เพิ่มออเดอร์เข้ารอบรถย้อนหลัง (ติดรถมาไม่ได้สแกน) — ห้าม dispatcher
    // COD — accounting sees the page read-only (write buttons below stay off)
    viewCod:           has('admin','manager','finance','dispatcher','accounting'),
    collectCod:        has('admin','manager','finance','dispatcher','driver_support'),
    remitCod:          has('admin','manager','finance'),
    setCodAmount:      has('admin','manager','dispatcher'),
    // Customs
    viewCustoms:       has('admin','manager','dispatcher','customs'),
    processCustoms:    has('admin','manager','customs'),
    customsClear:      has('admin','manager','customs'),  // used in customs/create.ejs inline buttons
    // Scanner
    useScanner:        has('admin','manager','dispatcher','warehouse_th','warehouse_la','branch_operator','driver_support'),
    // Customers
    editCustomer:      has('admin','manager','dispatcher'),
    deleteCustomer:    has('admin','manager'),
    viewCustomerInfo:  has('admin','manager','dispatcher','customer_service'),
    // Financial visibility — accounting (บัญชี) is read-only for investor reporting
    viewFinancials:    has('admin','manager','finance','accounting'),
    viewRevenue:       has('admin','manager','finance','accounting'),
    viewCostBreakdown: has('admin','manager','finance','accounting'),
    // Dispatch
    manageDispatch:    has('admin','manager','dispatcher','warehouse_la','warehouse_th'),
    // Users & system
    manageUsers:       has('admin'),
    manageRates:       has('admin'),
    manageBranches:    has('admin','manager'),
    // Branch portal
    branchPortal:      has('admin','manager','branch_operator'),
    // ร้านฝากส่ง
    manageFreight:         has('admin','manager','dispatcher','finance','staff'),
    collectFreightPayment: has('admin','manager','finance'),  // รับชำระเงิน — เข้มกว่า manageFreight
    // Expenses — accounting is read-only (view/export only, no add/delete)
    addExpense:        has('admin','manager','finance','dispatcher','driver_support'),
    deleteExpense:     has('admin','manager'),
    // ─── CRM ──────────────────────────────────────────────────────────────
    // View the CRM section in sidebar + access /crm routes
    viewCrm:           has('admin','manager','crm_admin','crm_supervisor','crm_agent',
                           'sales_agent','logistics_support','finance_support'),
    // CRM Admin — full control: settings, automation, all teams, merge customers
    manageCrm:         has('admin','crm_admin'),
    // CRM Supervisor — assign/reassign, team reports, SLA oversight
    superviseCrm:      has('admin','crm_admin','crm_supervisor'),
    // Use the inbox (reply, note, tag, close conversations)
    useInbox:          has('admin','crm_admin','crm_supervisor','crm_agent',
                           'sales_agent','logistics_support','finance_support'),

    // ─── Sidebar top-level link gating (previously ungated → leaked to every role)
    // Dashboard home — everyone except rider (riders use /rider as their home).
    // Financial widgets inside stay gated by viewFinancials/viewRevenue.
    viewDashboard:     role !== null && role !== 'rider',
    // Orders list — aligns with ROLES_READ (route guard on /orders)
    viewOrders:        has('admin','manager','dispatcher','warehouse_th','warehouse_la',
                           'finance','customer_service','driver_support','branch_operator','staff'),
    // Trips list — aligns with ROLES_READ (route guard on /trips)
    viewTrips:         has('admin','manager','dispatcher','warehouse_th','warehouse_la',
                           'finance','customer_service','driver_support','branch_operator','staff'),
    // Customers list — aligns with ROLES_CUSTOMER_VIEW (route guard on /customers)
    viewCustomers:     has('admin','manager','dispatcher','warehouse_th','warehouse_la',
                           'finance','staff','customs','customer_service'),
    // Partner / quotation — aligns with partner route guard
    viewPartner:       has('admin','manager','staff','branch_operator'),
  };

  next();
});


// ─── Request Logger (dev) ────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.method === 'POST' || req.path.startsWith('/orders')) {
    const orig = res.redirect.bind(res);
    res.redirect = function(url) {
      console.log(`[REQ] ${req.method} ${req.path} → redirect to ${url}`);
      return orig(url);
    };
    console.log(`[REQ] ${req.method} ${req.path} | body keys: ${Object.keys(req.body || {}).join(', ')}`);
  }
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use(authRoutes);
app.use(dashboardRoutes);
app.use(customersRoutes);
app.use(orderRoutes);
app.use(scannerRoutes);
app.use(tripRoutes);
app.use(customsRoutes);
app.use(codRoutes);
app.use(billingRoutes);
app.use(usersRoutes);
app.use(whatsappRoutes); // Enabled WhatsApp
app.use(settingsRoutes);
app.use(branchRoutes);  // ─ Branch Hub Network
app.use(dispatchRoutes);
app.use(partnerRoutes);  // ─ Partner Quotation System
app.use('/expenses', expensesRoutes);
app.use(spaceBookingRoutes); // ─ ร้านฝากส่ง (Space Booking)
app.use(riderRoutes);        // ─ Rider Mode (last-mile delivery)
app.use(riderAdminRoutes);   // ─ HQ (main-warehouse) rider management
// webhookRoutes already mounted above (before body-parser) — do NOT re-mount
// app.use(webhookRoutes);
app.use(webhookSimRoutes);   // ─ Dev webhook simulator (prod-blocked)
app.use(crmRoutes);          // ─ Omnichannel CRM


app.use(shopsDirectoryRoutes);
app.use(memberRoutes);
app.use(publicRoutes);

// '/' needs its own host-aware handler rather than the blind bounce list
// above: staff get the dashboard on either host; on the subdomain everyone
// else gets the customer home page; on the main host everyone else (regular
// customers who typed the bare domain, or anyone probing it) gets bounced to
// the customer subdomain instead of ever seeing a login form there — staff
// sign in via /login directly, which stays reachable on the main host no
// matter what this route does.
app.get('/', (req, res) => {
  if (req.session?.user) return res.redirect('/dashboard');
  if (res.locals.isMemberSubdomain) return publicController.home(req, res);
  return res.redirect(`//${res.locals.memberHost}/`);
});

// Temporary DB Migration Route for Production
import { exec } from 'child_process';
app.post('/api/fix-db', (req, res) => {
  if (req.session?.user?.role !== 'admin') return res.status(404).send('Not found');
  const nodePath = process.execPath;
  const scriptPath = path.join(__dirname, '../scripts/migrate_db.js');
  exec(`"${nodePath}" "${scriptPath}"`, { env: process.env }, (err, stdout, stderr) => {
    if (err) return res.send(`<pre style="color:red">Error: ${err.message}\n\n${stderr}</pre>`);
    res.send(`<pre style="color:green">Success!\n${stdout}</pre>`);
  });
});

// Business Card — public page, no auth required
app.get('/business-card', (req, res) => {
  res.render('business-card', { layout: false, title: 'นามบัตร | SNG Express' });
});

// Order Guide — printable PDF guide, no auth required
app.get('/order-guide', (req, res) => {
  res.render('order-guide', { layout: false, title: 'คู่มือสั่งสินค้าออนไลน์ | SNG Express' });
});

// System Manual — Role-based workflow guide
app.get('/system-manual', (req, res) => {
  res.render('system-manual', { 
    title: 'คู่มือการทำงานระบบ SNG Logistics',
    user: req.session.user || null
  });
});

// System Manual — Print/PDF version (standalone, no layout)
app.get('/system-manual/print', (req, res) => {
  res.render('system-manual-print', { 
    layout: false,
    title: 'คู่มือการทำงานระบบ SNG Logistics'
  });
});

// Tracking — public page, no auth required (QR code from sticker)
app.get('/track', tracking.trackLanding);
app.get('/track/:jobNo', tracking.trackOrder);

// Global 404 Handler
app.use('*', (req, res) => {
  if (req.session?.user) return res.redirect('/dashboard');
  res.status(404).render('customer/404', { title: 'ไม่พบหน้านี้ | SNG Express', layout: 'customer/layout' });
});

// ─── Error Handlers (MUST be after routes) ───────────────────────────────────
// CSRF error → friendly flash + redirect
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    console.error(`[CSRF ERROR] ${req.method} ${req.path} | Referrer: ${req.get('Referrer') || 'none'}`);
    req.session.flash = { type: 'error', message: 'Session หมดอายุ กรุณาลองใหม่' };
    return res.redirect(req.get('Referrer') || '/orders/new');
  }
  return next(err);
});

// Generic error handler — NEVER leak internal error details to client
app.use((err, req, res, _next) => {
  console.error('[APP ERROR]', err);
  const userMessage = isProduction
    ? 'Internal Server Error'
    : `Internal Server Error: ${err.message}`;
  res.status(500).send(userMessage);
});


// ─── Boot ─────────────────────────────────────────────────────────────────────
// NOTE: No process.argv check — Phusion Passenger (Plesk) requires the app to
//       ALWAYS call app.listen() regardless of how it is invoked.
const PORT = process.env.PORT || 3000;

export default app;

// ─── Socket.io Real-time Server ───────────────────────────────────────────────
const httpServer = createServer(app);
const socketOrigins = String(process.env.APP_ORIGIN || '')
  .split(',').map(value => value.trim()).filter(Boolean);
const io = new SocketIO(httpServer, {
  cors: {
    origin: isProduction ? socketOrigins : true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['polling'],  // WebSocket blocked by Apache proxy on Hostinger — use polling
});

io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  if (socket.request.session?.user) return next();
  const error = new Error('Authentication required');
  error.data = { code: 'AUTH_REQUIRED' };
  return next(error);
});

io.on('connection', (socket) => {
  const sessionUser = socket.request.session.user;
  const crmRoles = ['admin','manager','crm_admin','crm_supervisor','crm_agent',
    'sales_agent','logistics_support','finance_support'];
  // CRM agents join a shared room for inbox updates
  socket.on('crm:join', () => {
    if (!crmRoles.includes(sessionUser.role)) return;
    socket.join('crm:inbox');
    // Supervisors also join the supervisors-only alert room
    if (['admin','crm_admin','crm_supervisor'].includes(sessionUser.role)) {
      socket.join('crm:supervisors');
    }
    console.log(`[Socket.io] Client ${socket.id} joined crm:inbox (role: ${sessionUser.role})`);
  });

  // Agent joins a specific conversation room for typing indicators
  socket.on('crm:join_conversation', ({ conversationId }) => {
    if (crmRoles.includes(sessionUser.role) && /^\d+$/.test(String(conversationId))) {
      socket.join(`crm:conv:${conversationId}`);
    }
  });

  // Typing indicator relay
  socket.on('crm:typing', ({ conversationId, isTyping }) => {
    if (crmRoles.includes(sessionUser.role) && /^\d+$/.test(String(conversationId))) {
      socket.to(`crm:conv:${conversationId}`).emit('crm:typing', {
        agentName: sessionUser.name || sessionUser.username,
        isTyping: Boolean(isTyping),
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client ${socket.id} disconnected`);
  });
});

// Pass io to channel service so inbound messages can emit events
setIo(io);

try {
  await initDb();
  startSlaChecker(io); // Phase 5 — periodic SLA breach check
  startNotificationWorker();
} catch (err) {
  console.error('⚠️ [DB] Warning: DB initialization or worker startup failed:', err.message);
}

httpServer.listen(PORT, () => {
  console.log(`✅ SNG Logistics + CRM running at http://localhost:${PORT}`);
  console.log(`   NODE_ENV : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   DB_HOST  : ${process.env.DB_HOST}`);
  console.log(`   Socket.io: enabled (CRM real-time inbox)`);
});
