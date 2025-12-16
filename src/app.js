console.log("Starting application...");
import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import expressLayouts from 'express-ejs-layouts';
import csrf from 'csurf';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import orderRoutes from './routes/orders.js';
import tripRoutes from './routes/trips.js';
import customsRoutes from './routes/customs.js';
import codRoutes from './routes/cod.js';
import customersRoutes from './routes/customers.js';
import usersRoutes from './routes/users.js';
import whatsappRoutes from './routes/whatsapp.js';
import settingsRoutes from './routes/settings.js';
import pool from './config/db.js';

async function initDb() {
  try {
    // Ensure shipping_rates table exists (Fix for missing table error)
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
    console.log('[DB] Verified shipping_rates table exists.');
  } catch (err) {
    console.error('[DB] Error initializing database:', err);
  }
}

// Run DB init
initDb();

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const isProduction = process.env.NODE_ENV === 'production';

// Trust proxy for secure cookies behind Nginx/Plesk
app.set('trust proxy', 1);

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'sng_logistics_secret_key_9999',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction, // true on Production (HTTPS), false on Local
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
  })
);

app.use(csrf());

app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

// CSRF error handler for friendly feedback
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    req.session.flash = { type: 'error', message: 'Session expired or invalid form token. Please try again.' };
    return res.redirect(req.get('Referrer') || '/');
  }
  return next(err);
});

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.title = res.locals.title || 'sng logistics';
  next();
});

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(customersRoutes);
app.use(orderRoutes);
app.use(tripRoutes);
app.use(customsRoutes);

app.use(codRoutes);

app.use(usersRoutes);
app.use(whatsappRoutes);
app.use(settingsRoutes);

app.get('/', (req, res) => res.redirect('/dashboard'));

// Global 404 Handler - Redirect to Dashboard (which forces login if needed)
app.use('*', (req, res) => {
  res.redirect('/dashboard');
});

const PORT = process.env.PORT || 3000;

// Export app for Passenger/Tests
export default app;

// Only listen if executed directly (not imported)
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`sng logistics listening on ${PORT}`);
  });
}
