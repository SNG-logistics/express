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
import crmRoutes from './routes/crm.js';           // ─ Omnichannel CRM
import webhookRoutes from './routes/webhooks.js';   // ─ FB + LINE webhooks (public)
import webhookSimRoutes from './routes/webhookSim.js'; // ─ Dev simulator (blocked in prod)
import { setIo } from './services/channelService.js'; // ─ Socket.io ref
import { startSlaChecker } from './services/automationService.js'; // ─ SLA engine
import { createServer } from 'http';                // ─ Socket.io needs raw http server
import { Server as SocketIO } from 'socket.io';    // ─ Real-time CRM inbox
import * as tracking from './controllers/trackingController.js';

import { i18nMiddleware } from './middleware/i18n.js';
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

app.use(
  session({
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
  })
);

// ─── i18n (Thai/Lao) ────────────────────────────────────────────────────────
app.use(i18nMiddleware);

// ─── Raw POST logger (BEFORE csrf) ─────────────────────────────────────────
import fs from 'fs';
app.use((req, res, next) => {
  if (req.method === 'POST') {
    const logStr = `[RAW POST] ${req.path} | keys: ${Object.keys(req.body || {}).join(', ')}\n`;
    console.log(logStr);
    try { fs.appendFileSync('post_debug.log', logStr); } catch(e){}
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
  const has = (...roles) => role !== null && roles.includes(role);

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
    // COD
    viewCod:           has('admin','manager','finance','dispatcher'),
    collectCod:        has('admin','manager','finance','dispatcher','driver_support'),
    remitCod:          has('admin','manager','finance'),
    // Customs
    viewCustoms:       has('admin','manager','dispatcher','customs'),
    processCustoms:    has('admin','manager','customs'),
    customsClear:      has('admin','manager','customs'),  // used in customs/create.ejs inline buttons
    // Scanner
    useScanner:        has('admin','manager','dispatcher','warehouse_th','warehouse_la','branch_operator','driver_support','rider'),
    // Customers
    editCustomer:      has('admin','manager','dispatcher'),
    deleteCustomer:    has('admin','manager'),
    viewCustomerInfo:  has('admin','manager','dispatcher','customer_service'),
    // Financial visibility
    viewFinancials:    has('admin','manager','finance'),
    viewRevenue:       has('admin','manager','finance'),
    viewCostBreakdown: has('admin','manager','finance'),
    // Dispatch
    manageDispatch:    has('admin','manager','dispatcher','warehouse_la','warehouse_th'),
    // Users & system
    manageUsers:       has('admin'),
    manageRates:       has('admin'),
    manageBranches:    has('admin','manager'),
    // Branch portal
    branchPortal:      has('admin','manager','branch_operator'),
    // ร้านฝากส่ง
    manageFreight:     has('admin','manager','dispatcher','finance','staff'),
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
app.use(usersRoutes);
app.use(whatsappRoutes); // Enabled WhatsApp
app.use(settingsRoutes);
app.use(branchRoutes);  // ─ Branch Hub Network
app.use(dispatchRoutes);
app.use(partnerRoutes);  // ─ Partner Quotation System
app.use('/expenses', expensesRoutes);
app.use(spaceBookingRoutes); // ─ ร้านฝากส่ง (Space Booking)
app.use(riderRoutes);        // ─ Rider Mode (last-mile delivery)
app.use(webhookRoutes);      // ─ FB + LINE public webhooks (NO auth)
app.use(webhookSimRoutes);   // ─ Dev webhook simulator (prod-blocked)
app.use(crmRoutes);          // ─ Omnichannel CRM


app.get('/', (req, res) => res.redirect('/dashboard'));

// Temporary DB Migration Route for Production
import { exec } from 'child_process';
app.get('/api/fix-db', (req, res) => {
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
  res.redirect('/dashboard');
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
app.use((err, req, res, next) => {
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
const io = new SocketIO(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

io.on('connection', (socket) => {
  // CRM agents join a shared room for inbox updates
  socket.on('crm:join', (data) => {
    socket.join('crm:inbox');
    // Supervisors also join the supervisors-only alert room
    if (data?.role && ['admin','crm_admin','crm_supervisor'].includes(data.role)) {
      socket.join('crm:supervisors');
    }
    console.log(`[Socket.io] Client ${socket.id} joined crm:inbox (role: ${data?.role || 'unknown'})`);
  });

  // Agent joins a specific conversation room for typing indicators
  socket.on('crm:join_conversation', ({ conversationId }) => {
    if (conversationId) socket.join(`crm:conv:${conversationId}`);
  });

  // Typing indicator relay
  socket.on('crm:typing', ({ conversationId, agentName, isTyping }) => {
    socket.to(`crm:conv:${conversationId}`).emit('crm:typing', { agentName, isTyping });
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client ${socket.id} disconnected`);
  });
});

// Pass io to channel service so inbound messages can emit events
setIo(io);

await initDb();
startSlaChecker(io); // Phase 5 — periodic SLA breach check

httpServer.listen(PORT, () => {
  console.log(`✅ SNG Logistics + CRM running at http://localhost:${PORT}`);
  console.log(`   NODE_ENV : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   DB_HOST  : ${process.env.DB_HOST}`);
  console.log(`   Socket.io: enabled (CRM real-time inbox)`);
});

