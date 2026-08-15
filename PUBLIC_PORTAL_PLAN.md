# SNG Logistics — Public Customer Portal — Phased Implementation Plan

**Status:** For review → execute by @sixth (Fable 5)
**Scope:** Planning document only. No application code is written here.
**Target stack:** Node 20+, Express 4 + EJS + `express-ejs-layouts`, MySQL 5.7/8 via `mysql2`, `express-session` + `express-mysql-session` (store table `sessions`), global `csurf` (except `CSRF_SKIP`), global `i18nMiddleware` (`?lang=th|lo`, `t()` in every view), Tailwind Play CDN + Alpine.js CDN (no build step). All imports are ESM (`"type": "module"` in `package.json`).

---

## 0. Why this plan exists

SNG Logistics has **no public-facing website**. `GET /` unconditionally redirects to `/dashboard` → `/login` for every visitor. The only public page is `GET /track` + `GET /track/:jobNo` (real, functional, QR-reachable from shipping stickers), but it is orphaned (linked nowhere), uses the Inter font (no Thai glyphs) on a 100% Thai/Lao page, uses `layout:false` + inline `<style>`, and has no Lao toggle despite being a TH↔LA service.

The owner wants a customer-facing portal modeled for *information architecture* on a competitor app ("HAL Express": search-first, service-shortcut grid, member profile with points/coupons/referral), but branded **gold-on-black (SNG logo identity: `#FFE000` on dark)** — deliberately *not* the internal admin's cyan/blue `luxury.css` theme. This is an intentional dual-theme choice.

Two rounds of clarifying questions on open items (price-check mechanism, review eligibility) were dismissed unanswered. This plan applies explicit, reversible defaults (see §7 Open Decisions) rather than blocking.

---

## 1. Verified current state (facts this plan is built on)

All statements below were verified against the repo at plan time.

| Concern | Verified fact | Location |
|---|---|---|
| `/` and 404 | Both redirect to `/dashboard` unconditionally | `src/app.js` (`app.get('/')`, catch-all `app.use('*')` near bottom) |
| Tracking | `trackOrder` + `trackLanding`; public timeline already filters `note NOT LIKE '%[EXCEPTION]%'` and `'%[INTERNAL]%'` | `src/controllers/trackingController.js` |
| Tracking view | `layout:false`, inline `<style>`, Inter font, TH-only labels, no Lao toggle | `views/tracking/index.ejs` |
| WhatsApp | `sendTextMessage(phoneRaw, text)` exists; **throws `{ code: 'WHATSAPP_NOT_READY' }`** when Baileys socket is down; uses `toWaPhone()` | `src/services/whatsappService.js` |
| Phone normalizer | `toWaPhone()`, `toJid()`, `sameWaPhone()` — TH `66` / LA `856` prefixes | `src/utils/waPhone.js` |
| Staff auth | `requireLogin`/`requireRole` read `req.session.user`; `loginRateLimit` is **in-memory per-IP** (`5/15min`); `regenerateSession()` preserves only `returnTo` + `flash` (destroys everything else) | `src/middleware/auth.js` |
| Staff login | bcryptjs compare; session-fixation-safe regenerate | `src/controllers/authController.js` |
| Rate calculation | `GET /api/shipping-price?weight&width&length&height` (staff-only): `dimSum = W+L+H`, `volumetric = W*L*H/5000`, `chargeableKg = max(weight,volumetric)`, pick cheapest qualifying `shipping_rates` row, price via `computeRatePrice` | `src/controllers/settingsController.js` (`calculatePrice`) |
| Pricing service | `computeRatePrice`, `parseDimensionSum`, `resolveShippingRate` already exported; **`findBestShippingRate` does NOT exist** — genuinely new | `src/services/pricingService.js` |
| `shipping_rates` cols | `id, name, max_weight, max_dimension, price, price_per_kg, active` — no cost/margin data; **no `direction` column** (TH→LA vs LA→TH is labeling only today) | `database/schema.sql`, `migrate_016`, `migrate_018` |
| Rates seeds | Starter rows `A`, `A+`, `ของใช้ทั่วไป`, `เสื้อผ้า`, `เฟอร์นิเจอร์` (idempotent) | `database/migrate_018_app_bootstrap.sql` |
| `company_settings` | Bilingual keys exist: `company_name*`, `company_address*`, `company_phone*`, `company_tax_id*`, `company_email*` (`*` = `_th`/`_la`), `company_logo`; loaded ad-hoc by an **unexported local helper** in settings controller | `scripts/init_company_settings.mjs`, `scripts/add_lao_company_settings.mjs`, `src/controllers/settingsController.js` |
| `users` | Staff-only, role enum; no customer login exists | `database/schema.sql` |
| `customers` | Sender/receiver records, no login; columns `id,type,name,phone,email,country,province,city,address,tax_id,active` — **no `phone_normalized`** | `database/schema.sql` |
| `freight_partners` | Internal credit/billing table (`credit_days`, `credit_limit_thb`, `tax_id`, …); all `/freight/*` routes `requireLogin`+role-gated | `database/migrate_010_space_booking.sql`, `src/routes/spaceBooking.js` |
| `partner_quotations` | Full staff-side quotation workflow already exists (`product_url`, `product_price_thb`, `fx_spread_pct`, `service_fee_lak`, `total_lak`, status `draft|sent|accepted|ordered|cancelled`, `order_id`) — staff-only | `src/app.js` (`initDb`), `src/controllers/partnerController.js`, `src/routes/partner.js` |
| CRM | `crm_customers` is a separate identity graph synced one-way from `customers` | `database/migrate_013_crm_customer_sync.sql` |
| i18n | `t()`, `lang`, `otherLang` etc. global via middleware; **`status.*` keys exist in `th.json`/`lo.json`** | `src/middleware/i18n.js`, `src/i18n/th.json`, `src/i18n/lo.json` |
| i18n gap ⚠️ | `status.*` dicts are **missing** newer order statuses: `ARRIVED_BORDER_WH`, `CUSTOMS_REJECTED`, `BRANCH_TRANSFER`, `BRANCH_RECEIVED`, `RIDER_ASSIGNED`, `RIDER_ACCEPTED`, `COD_COLLECTED`, `COD_REMITTED`, `RETURN_TO_SENDER`, `CLOSED` | `src/i18n/*.json` vs `src/constants/statuses.js` |
| Brand assets | Only `public/images/snglogo.png` (532 KB); **no favicon anywhere** | `public/images/` |
| Fonts (admin) | Noto Sans Thai + Noto Sans Lao + Prompt via `<link>`, with a manual `@font-face` `unicode-range: U+0E80–0EFF` fallback | `views/layouts/main.ejs`, `public/css/luxury.css` |
| Admin theme | Cyan/blue tokens (`--brand-cyan:#06b6d4`, `--brand-blue:#3b82f6`, `--bg-body:#080b14`) | `public/css/luxury.css` |
| Migrations | `scripts/migrate_db.js` runs `SQL_FILES` in order, checksums each, idempotent; **`migrate_021_role_enum_canonical.sql` must remain LAST** (canonical role enum re-asserted) | `scripts/migrate_db.js` |
| Deps | `bcryptjs` ✓ (used by staff auth), `multer` ✓, `csurf` ✓, `socket.io` ✓, `@whiskeysockets/baileys` ✓. **`sharp` NOT installed** — to be added as devDependency for asset generation | `package.json` |

---

## 2. Phase sequencing (and why)

Reordered from the owner's original 1-2-3 grouping by *actual dependency risk*:

| Phase | Contents | Why here |
|---|---|---|
| **1a** | Public quick wins — home page, re-themed tracking, public calculator, favicon/logo cleanup, fix `/` + 404 | Zero auth, zero new tables, independently shippable, lowest risk, immediately visible value |
| **1b** | Member accounts + WhatsApp OTP | The foundational, highest-risk piece (new auth flow, new session concept, OTP abuse surface). Phases 2+ that need real customer identity depend on it |
| **2** | Partner-shop directory + reviews | Needs verified members (Phase 1b) for reviews |
| **3** | Thai product price-check / buy-agent service | Benefits from member identity (quote history); staff fulfillment already exists (`partner_quotations`) |
| **4** | Loyalty layer (points/coupons/referral/lucky draw) | **No business rules exist.** Phase 4 starts with the owner defining rules, not code |

---

## 3. Phase 1a — Public quick wins (no auth, no new DB tables)

### 3.1 `src/app.js` — make route roots session-aware (do FIRST)

Replace the two hard redirects with one shared helper (inline in `app.js`):

```js
function routeLoggedOutUser(req, res, next) {
  // staff session → dashboard (today's behavior)
  if (req.session?.user) return res.redirect('/dashboard');
  // everyone else → public site
  return next();
}
```

- `app.get('/', routeLoggedOutUser, publicController.home)` — new public home page.
- Catch-all `app.use('*', routeLoggedOutUser, (req,res) => { ... })` — staff → `/dashboard`; public → render a simple `views/errors/404-public.ejs` (or redirect to `/`). Do **not** render the admin `views/errors/403` path.
- Mount the new router **before** the tracking routes: `app.use(publicRoutes)`.
- Keep `app.use(webhookRoutes)` first (raw-body requirement) — do not disturb boot order otherwise.
- No change to session middleware, CSRF, or i18n ordering. `res.locals.csrfToken` is already set globally for every view — public EJS forms just emit `<input type="hidden" name="_csrf" value="<%= csrfToken %>">` (GET pages don't need it).

### 3.2 New public layout + stylesheet

- **`views/layouts/public.ejs`** (new) — the public shell:
  - `<html lang="<%= lang || 'th' %>">`; viewport; title from `res.locals.title`.
  - Same font stack as `main.ejs`: Noto Sans Thai / Noto Sans Lao / Prompt `<link>` + the `unicode-range` fallback pattern (copy from `luxury.css` so Lao glyphs always render).
  - Tailwind Play CDN with `preflight: false` + Alpine.js + Font Awesome — identical loading pattern to `main.ejs`.
  - New `public/css/portal.css` (below).
  - `<%- body %>` inside an `<main>`.
  - `include('../components/public-navbar')`.
  - Language toggle `<a href="?lang=<%= otherLang %>">` (works because `i18nMiddleware` persists `lang` to `req.session.lang`, and sessions are enabled for public visitors too) — shows `langFlag` / `otherLabel`.
  - Favicon `<link>` set (see §3.5) + PWA hooks (see §7.4).
  - Flash rendering: reuse the same `req.session.flash` → `res.locals.flash` pattern (already global) so member forms later share it.
- **`public/css/portal.css`** (new) — gold/black tokens, deliberately separate from `luxury.css`:
  ```css
  :root {
    --portal-gold: #FFE000;
    --portal-gold-dim: rgba(255, 224, 0, 0.65);
    --portal-bg: #0a0a0a;          /* near-black, matches logo bg */
    --portal-surface: #141414;
    --portal-surface-2: #1c1c1c;
    --portal-border: rgba(255,255,255,0.10);
    --portal-text: #f5f5f5;
    --portal-text-dim: rgba(255,255,255,0.55);
    --portal-text-faint: rgba(255,255,255,0.30);
    --portal-success: #22c55e;
    --portal-danger: #ef4444;
    --portal-radius: 1rem;
  }
  ```
  - Cartoon-brutalist-leaning, chunky, gold-accented mobile-first components: `.card`, `.btn-gold` (gold fill, black text), `.btn-ghost`, `.input-portal`, `.status-badge`, `.timeline`, `.bottom-nav`, `.chip`, `.empty-state`. All flat, no gradients on brand surfaces (gold on black only; zero cyan/blue).

### 3.3 Public navbar

- **`views/components/public-navbar.ejs`** (new) — fixed **bottom tab bar** (mobile-first, matches reference-app pattern):
  - Home (`/`), ติดตาม (`/track`), คำนวณ (`/calculate`), ร้านค้า (`/shops` — Phase 2 placeholder tile; before Phase 2 ships it links to `#` or renders a "เร็วๆ นี้" state), บัญชี (`/member/login` if no `req.session.customer`, else `/member/profile`).
  - Active-state detection from `res.locals.currentPath` (already global in `app.js`).
  - Also a compact top strip on ≥sm widths with the logo + contact info from `company_settings` (§3.6).
  - Export a **`portalCurrentUser`** local from the router middleware (below) so the navbar can show "เข้าสู่ระบบ / สมัครสมาชิก" vs the member's first name.

### 3.4 Home page

- **`src/controllers/publicController.js`** (new):
  - `home(req,res)` — loads `company_settings` via the new service (§3.6), renders `views/public/home.ejs` on `layouts/public` (set per-controller: `res.render('public/home', {...})` with `layout: 'layouts/public'`, or set a sub-app `app.set('layout', ...)` only for the public router — use the per-render option to avoid mutating the global layout used by admin).
  - `calculatePage(req,res)` — SSR server-rendered calculator (see §3.7).
- **`src/routes/public.js`** (new):
  ```
  GET  /                 → publicController.home            (no session split needed; app.js pre-routes staff)
  GET  /calculate        → publicController.calculatePage
  GET  /api/public/shipping-quote → publicController.shippingQuote (JSON, rate-limited)
  ```
  Mount with `app.use(publicRoutes)` **before** the tracking/catch-all lines in `app.js`.
- **`views/public/home.ejs`** (new) — IA mirrors the reference app:
  1. Brand header: gold wordmark "SNG EXPRESS" + bilingual tagline (from `company_settings`/`t()`).
  2. **Tracking search bar front-and-center**: `<form action="/track" method="GET">` with `name="q"` — reuses existing `trackLanding` (`GET /track?q=...` → redirect to `/track/:jobNo`). No new endpoint.
  3. Empty/result state below the search: on load show "พิมพ์เลขพัสดุเพื่อติดตาม" empty state; if `?q=` failed, the redirect already lands on `/track/:jobNo` which renders its own error card — home itself stays a pure landing page.
  4. **Service shortcut grid** (4 tiles): ติดตามพัสดุ (`/track`), คำนวณค่าส่ง (`/calculate`), ร้านค้าเข้าร่วม (`/shops` — "เร็วๆ นี้" until Phase 2), สมัครสมาชิก/เข้าสู่ระบบ (`/member/register` or `/member/login`; if logged-in member → `/member/profile`).
  5. Footer: company TH/LA name/address/phone/email from `company_settings`, + Lao toggle.

### 3.5 Tracking page re-theme (no controller change)

`src/controllers/trackingController.js` logic (lookup, internal-note filtering) is correct — **do not touch it**. Rebuild the view only:

- **Rewrite `views/tracking/index.ejs`** on `layouts/public`:
  - Remove `layout:false`, the inline `<style>`, and Inter. Use `portal.css`.
  - Use `t('status.<log.to_status>')` for timeline labels and the current-status badge instead of the Thai-only `ORDER_STATUS_LABELS` — gives TH/LA instantly via the existing toggle.
  - Preserve all existing info shown today (job_no, direction, flags, sender/receiver, destination, weight, COD, created/updated, timeline) and the existing internal-note filtering behavior (filtering is server-side; view unchanged in that respect).
  - Keep the query-string search form (`action="/track" method="GET" name="q"`).
  - Link this page from home + navbar (today it's orphaned).
- **Extend `src/i18n/th.json` + `src/i18n/lo.json`** — add the missing `status.*` keys listed in §1 so no timeline falls back to a raw status key: `ARRIVED_BORDER_WH`, `CUSTOMS_REJECTED`, `BRANCH_TRANSFER`, `BRANCH_RECEIVED`, `RIDER_ASSIGNED`, `RIDER_ACCEPTED`, `COD_COLLECTED`, `COD_REMITTED`, `RETURN_TO_SENDER`, `CLOSED`.

### 3.6 Shared company-settings service (extraction)

- **`src/services/companySettingsService.js`** (new):
  ```js
  export async function getCompanySettings() // → { key: value } for all rows
  export async function getCompanyBilingual() // → { th: {...}, la: {...} } convenience
  ```
- Update `src/controllers/settingsController.js` to import `getCompanySettings` from the new service and **delete the local unexported helper** — single source of truth, zero behavior change.
- Public controllers call it instead of importing the admin controller.

### 3.7 Public shipping calculator

- **Extract shared rate-matching logic** into `src/services/pricingService.js`:
  ```js
  /**
   * Select the cheapest active rate that fits the parcel.
   * Mirrors settingsController.calculatePrice EXACTLY (same math, same shape).
   */
  export async function findBestShippingRate({ weightKg = 0, lengthCm = 0, widthCm = 0, heightCm = 0 })
  // → { price, found, rate_id, rate_name, details: { chargeableKg, volumetricWeight, dimSum } }
  ```
  - Math to replicate verbatim: `dimSum = W+L+H`; `volumetricWeight = (W*L*H)/5000`; `chargeableKg = max(weightKg, volumetricWeight)`; query `shipping_rates WHERE active=1 AND max_weight >= chargeableKg AND (max_dimension=0 OR max_dimension >= dimSum)`; sort by computed price ascending; take first.
  - **Refactor `settingsController.calculatePrice` to call `findBestShippingRate`** — same inputs, same JSON response shape ⇒ the existing internal `/api/shipping-price` behavior is byte-identical. This is a functional requirement of the extraction, not just style.
- **Public pages**:
  - `GET /calculate` — SSR page (works with query params like `/track` does): `?weight_kg=&length_cm=&width_cm=&height_cm=` renders the estimate server-side for deep-linkability/no-JS.
  - `GET /api/public/shipping-quote?weight_kg=&length_cm=&width_cm=&height_cm=` — JSON, same response as the internal endpoint minus nothing sensitive (the response already contains only price/rate name/derived numbers — safe). Used by a small inline script on `/calculate` for instant recalculation as fields change.
- **Rate limiting** — in-memory sliding window per-IP on the public JSON endpoint (same pattern as `loginRateLimit` in `src/middleware/auth.js`; e.g. 60 req/15min). Acceptable here because the cost of an abusive request is trivial (unlike OTP, see §4.4).
- **UI note** (stable fact, not a bug): `shipping_rates` has no `direction` column — the calculator is direction-agnostic; label it "ค่าส่งไทย ↔ ลาว" and show THB.

### 3.8 Brand assets + favicon

- **Add `sharp` as a devDependency** (`npm i -D sharp`). `sharp` is used only inside build/seed-time scripts, keeping the runtime deps unchanged.
- **`scripts/generate_brand_assets.mjs`** (new, one-off, idempotent — safe to re-run):
  - Input: `public/images/snglogo.png`.
  - Outputs:
    - `public/images/sng-logo-nav.png` — compact nav-sized logo (e.g. ≤ 24–40px rendered, tiny bytes).
    - `public/favicon/favicon.ico`
    - `public/favicon/favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon-180x180.png`, `android-chrome-192x192.png`, `android-chrome-512x512.png`.
  - Reference from `views/layouts/public.ejs` (all of them); optionally back-port the favicon `<link>` set into `views/layouts/main.ejs` too (the internal app has none either) — cheap win, no risk.
- **Do not delete** the original `snglogo.png` (used by admin sidebar + `company_logo` setting).

### 3.9 Phase 1a — route/controller/view inventory (new vs modified)

| File | Action |
|---|---|
| `src/app.js` | MODIFY — session-aware `/` and 404, mount `publicRoutes` |
| `src/services/companySettingsService.js` | NEW |
| `src/controllers/settingsController.js` | MODIFY — use extracted service + `findBestShippingRate` |
| `src/services/pricingService.js` | MODIFY — add `findBestShippingRate` |
| `src/controllers/publicController.js` | NEW |
| `src/routes/public.js` | NEW |
| `src/middleware/auth.js` | MODIFY — add small reusable `publicRateLimit(options)` factory (used by calculator JSON; reused by OTP in 1b where it's replaced by DB-backed limits) |
| `views/layouts/public.ejs` | NEW |
| `views/components/public-navbar.ejs` | NEW |
| `views/public/home.ejs` | NEW |
| `views/tracking/index.ejs` | REWRITE (layout + i18n, no controller change) |
| `views/errors/404-public.ejs` | NEW |
| `public/css/portal.css` | NEW |
| `public/images/sng-logo-nav.png`, `public/favicon/*` | NEW (script-generated) |
| `src/i18n/th.json`, `src/i18n/lo.json` | MODIFY — add missing `status.*` keys |
| `scripts/generate_brand_assets.mjs` | NEW |
| `package.json` | MODIFY — devDep `sharp` |

---

## 4. Phase 1b — Member accounts + WhatsApp OTP

### 4.1 New DB migration: `database/migrate_025_customer_accounts.sql`

Follow the repo's idempotent `IF NOT EXISTS` / `INFORMATION_SCHEMA` guard style. **Registration in `scripts/migrate_db.js`: insert `'migrate_025_customer_accounts.sql'` into `SQL_FILES` BEFORE `'migrate_021_role_enum_canonical.sql'`** (which must stay last). Do not append after it.

**`customer_accounts`** — deliberately separate concept from the three existing identity stores:
- `users` — staff only (roles: admin, manager, …). Never touch.
- `customers` — sender/receiver address-book records; no login.
- `crm_customers` — CRM's own synced graph.

```sql
CREATE TABLE IF NOT EXISTS customer_accounts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  phone VARCHAR(20) NOT NULL UNIQUE COMMENT 'normalized via toWaPhone(), e.g. 6681... / 85620...',
  phone_display VARCHAR(30) NOT NULL COMMENT 'as user typed it',
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(120) NOT NULL DEFAULT '',
  last_name VARCHAR(120) NOT NULL DEFAULT '',
  gender ENUM('male','female','other') NULL,
  referral_code VARCHAR(20) NULL UNIQUE COMMENT 'member shares this; generated at activation',
  referred_by_account_id BIGINT UNSIGNED NULL,
  legacy_customer_id BIGINT UNSIGNED NULL COMMENT 'optional soft link to customers.id; NOT auto-populated',
  status ENUM('pending_verification','active','disabled') NOT NULL DEFAULT 'pending_verification',
  phone_verified_at TIMESTAMP NULL,
  avatar_path VARCHAR(255) NULL,
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ca_phone (phone),
  INDEX idx_ca_status (status),
  CONSTRAINT fk_ca_referred_by FOREIGN KEY (referred_by_account_id) REFERENCES customer_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Public member accounts (OTP-verified via WhatsApp). Distinct from staff users.';
```

**`customer_otp_codes`** — one table, two purposes.

```sql
CREATE TABLE IF NOT EXISTS customer_otp_codes (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  account_id BIGINT UNSIGNED NOT NULL,
  purpose ENUM('REGISTER','RESET_PASSWORD') NOT NULL,
  code_hash VARCHAR(255) NOT NULL COMMENT 'bcryptjs hash, never plaintext',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 5,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP NULL,
  requested_ip VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_account (account_id, purpose),
  INDEX idx_otp_ip_window (requested_ip, created_at),
  INDEX idx_otp_phone_window (created_at),
  CONSTRAINT fk_otp_account FOREIGN KEY (account_id) REFERENCES customer_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='WhatsApp OTP codes (bcrypt-hashed) for phone verification + password reset';
```

> Design note: storing the *normalized phone* on the OTP rows via the account FK plus `created_at` is what makes rate limits DB-backed (see §4.4). A phone-keyed index on `customer_accounts.phone` is enough for per-phone windows; for per-IP windows use `requested_ip`.

**`customers.phone_normalized`** — same migration:
```sql
ALTER TABLE customers ADD COLUMN phone_normalized VARCHAR(20) NULL AFTER phone;
CREATE INDEX idx_customers_phone_normalized ON customers (phone_normalized);
```
- **Backfill script** `scripts/backfill_customer_phone_normalized.mjs` (new, one-off): `SELECT id, phone FROM customers`, run each through the **existing** `toWaPhone()`, `UPDATE customers SET phone_normalized=? WHERE id=?`.
- **Going forward** — one small additive edit at the insert/update sites of `src/controllers/customersController.js` to also write `phone_normalized = toWaPhone(phone)`. Imports `toWaPhone` from `src/utils/waPhone.js`.

### 4.2 Member ↔ existing order linkage ("my orders")

- **No FK from `customer_accounts.legacy_customer_id` at signup.** Phone matches against `sender_id`/`receiver_id` are ambiguous (same phone may be many `customers` rows). So:
  - At activation, set `legacy_customer_id` only if *exactly one* `customers` row matches `phone_normalized` (best-effort, optional, staff-visible later).
  - `GET /member/orders` runs:
    ```sql
    SELECT DISTINCT o.*, s.name AS sender_name, r.name AS receiver_name
    FROM orders o
    LEFT JOIN customers s ON s.id = o.sender_id
    LEFT JOIN customers r ON r.id = o.receiver_id
    WHERE s.phone_normalized = ? OR r.phone_normalized = ?
    ORDER BY o.created_at DESC
    ```
    This is safe **specifically because** the member's phone was OTP-verified — the member demonstrably owns the number, so exposing order rows tied to that number to them is correct.
  - Order detail from the member view: reuse the existing public-safe projection from `trackingController.trackOrder` (which already strips internal notes).

### 4.3 Session isolation — customer ≠ staff, but share the session store

- Same `express-session` middleware, cookie (`sng.sid`), and MySQL store (shared `sessions` table). **Do not create a second session middleware.**
- Member identity lives at **`req.session.customer`** — a brand-new namespace. Staff identity remains `req.session.user`, read by every existing `requireLogin`/`requireRole`. A customer can never accidentally satisfy `requireLogin` because those guards only read `req.session.user`, and the `res.locals.currentUser`/`can.*` locals are built from `req.session.user` only. The public layout reads `req.session.customer` via its own middleware; it never sets `currentUser`.
- **New `src/middleware/customerAuth.js`** mirroring `src/middleware/auth.js`:
  - `requireCustomerLogin(req,res,next)` — `if (req.session?.customer) return next(); store returnTo; redirect('/member/login')`.
  - `requireCustomerVerified(req,res,next)` — for routes needing an *active* (verified) member (orders, profile, reviews in Phase 2).
  - `regenerateCustomerSession(req, payload, cb)` — `req.session.regenerate(...)` then re-set `req.session.customer = payload`.
- **⚠️ Cross-namespace preservation (explicit requirement).** `regenerateSession()` in `src/middleware/auth.js` destroys the whole session. If one browser ever holds staff *and* customer identities, a naive `regenerateCustomerSession` would wipe `req.session.user` (and vice-versa). Therefore:
  - Modify `regenerateSession` (staff) to additionally re-copy `req.session.customer` across the regenerate, alongside the existing `returnTo`/`flash` preservation.
  - `regenerateCustomerSession` must equally re-copy `req.session.user`.
  - This is the one deliberate touch to existing auth code; nothing else in staff auth changes.
- Payload shapes:
  - Staff (`req.session.user`): `{ id, username, role, name, branch_id }` — **unchanged**.
  - Customer (`req.session.customer`): `{ id, phone, first_name, last_name, referral_code, status, legacy_customer_id }` — distinct keys, no `role` field ever.

### 4.4 WhatsApp OTP — end-to-end + abuse control

**Flow (registration):**
1. `GET /member/register` → form (first name, last name, gender, phone, password + confirm, optional referral code).
2. `POST /member/register`:
   - Validate; normalize phone with **existing `toWaPhone()`**; reject non-TH/LA-prefixable numbers.
   - If a `pending_verification` account for that phone exists and is stale (created > 15 min ago or its OTPs are all consumed/expired), **reuse/overwrite it** (reset `first_name`/`last_name`/`gender`/`password_hash`) rather than erroring on the UNIQUE `phone` constraint — no orphaned rows, no phone squatting.
   - If an `active` account for that phone exists → friendly "หมายเลขนี้สมัครแล้ว กรุณาเข้าสู่ระบบ" (do not reveal more).
   - Create/reuse account as `status='pending_verification'`.
   - Generate 6-digit numeric code; store **`bcryptjs.hash(code)`** in `customer_otp_codes` (`purpose='REGISTER'`, `max_attempts=5`, `expires_at=NOW()+5min`).
   - Send via **existing `sendTextMessage(phoneRaw, 'SNG Express รหัสยืนยันของคุณ: 123456 (หมดอายุใน 5 นาที)')`** — direct call, same pattern as rider job offers. Do **not** route through the `customer_notification_outbox` async worker — OTP is time-sensitive (the worker batches every 30s and retries on `WHATSAPP_NOT_READY`, which is wrong for a 5-min code).
   - Set `req.session.pendingVerification = { accountId, phone, purpose:'REGISTER', expiresAt }` (session-only, never a URL param) → redirect `GET /member/verify`.
3. `GET /member/verify` — shows phone + code input (digits only), resend button, cooldown countdown (client-side clock from server-provided `nextAllowedAt`).
4. `POST /member/verify`:
   - Look up latest unconsumed, unexpired OTP row for `accountId+purpose='REGISTER'`.
   - `bcryptjs.compare(submitted, code_hash)`; increment `attempts` on mismatch; at `attempts >= max_attempts` set `consumed_at` (locked) → "รหัสไม่ถูกต้องเกินกำหนด" + allow resend.
   - On success: set `consumed_at`, flip account to `active`, set `phone_verified_at=NOW()`, generate `referral_code` (e.g. `SNG` + 8 random chars, UNIQUE), clear `pendingVerification`, **`regenerateCustomerSession`** → `/member/profile`.
5. `POST /member/verify/resend` — new code, same purpose, subject to the DB rate limits below.

**Flow (forgot password):** `GET/POST /member/forgot-password` (phone → OTP with `purpose='RESET_PASSWORD'`, no account creation), then `GET/POST /member/reset-password` (verify code → set new `password_hash` → consume code → redirect login). Same table, same limits.

**Abuse control — DB-backed, not in-memory (critical).** The app runs under Phusion Passenger (multi-worker), so `loginRateLimit`-style in-memory counters are bypassable by hitting different workers. Enforce with SQL against `customer_otp_codes` + `customer_accounts`:
- Resend cooldown: `COUNT(*) WHERE account_id=? AND purpose=? AND created_at > NOW() - INTERVAL 60 SECOND` ≥ 1 → reject.
- Per-phone: `COUNT(*) WHERE account_id = (SELECT id FROM customer_accounts WHERE phone=?) AND purpose=? AND created_at > NOW() - INTERVAL 10 MINUTE` ≤ 3 sends.
- Daily per-phone & per-IP caps (e.g. 10/day each) — separate `COUNT` over 24 h. These become new methods in `src/services/otpService.js` (`assertAllowedToSend`, `recordSend`), each a single guarded SQL check inside the same transaction that inserts the code — no TOCTOU window.
- All limits produce `429`-style friendly messages with the retry time in seconds (pass `nextAllowedAt` to the view for the countdown).

**`WHATSAPP_NOT_READY` handling:** `sendTextMessage` throws `{ code:'WHATSAPP_NOT_READY' }` when Baileys is disconnected. On that code: do **not** consume/resend; render a friendly "ระบบยืนยันตัวตนชั่วคราวไม่ว่าง กรุณาลองใหม่ใน 2–3 นาที" message. There is no SMS fallback (§7.5). The code row stays valid until its 5-min expiry, and the send isn't counted against the rate limit.

### 4.5 New service: `src/services/otpService.js`

Kept out of the controller (mirrors `pricingService` layering):
```
generateCode()                       → 6-digit string
createOtp(conn, {accountId, purpose, ip})      → validates DB rate limits, inserts bcrypt hash, returns { code, expiresAt }
verifyCode({accountId, purpose, code})         → bcrypt compare, attempt counting, lockout, consume-on-success
resendCooldownRemainingSec({accountId, purpose})
requestPasswordReset({phone, ip})              → find active account by toWaPhone(phone), create OTP (purpose RESET_PASSWORD), send
completePasswordReset({accountId, purpose, code, newPassword})
```

### 4.6 Routes / controller / views inventory

| File | Action | Routes |
|---|---|---|
| `src/routes/member.js` | NEW | `GET /member/register`, `POST /member/register`, `GET /member/verify`, `POST /member/verify`, `POST /member/verify/resend`, `GET /member/login`, `POST /member/login`, `POST /member/logout`, `GET /member/forgot-password`, `POST /member/forgot-password`, `GET /member/reset-password`, `POST /member/reset-password`, `GET /member/profile` (auth), `GET /member/orders` (auth+verified), `GET /member/account` (auth), `POST /member/account` (auth — name/gender only; **phone change re-triggers OTP, deferred**), `GET /member/orders/:jobNo` (auth+verified, public-safe projection) |
| `src/controllers/memberController.js` | NEW | one handler per route above; all POSTs leave default CSRF protection active (not in `CSRF_SKIP`) |
| `src/middleware/customerAuth.js` | NEW | `requireCustomerLogin`, `requireCustomerVerified`, `regenerateCustomerSession` |
| `src/middleware/auth.js` | MODIFY | staff `regenerateSession` preserves `req.session.customer` |
| `src/services/otpService.js` | NEW | §4.5 |
| `src/controllers/customersController.js` | MODIFY | write `phone_normalized` at insert/update |
| `views/member/register.ejs`, `verify.ejs`, `login.ejs`, `forgot-password.ejs`, `reset-password.ejs`, `profile.ejs`, `orders.ejs`, `order-detail.ejs`, `account.ejs` | NEW | all on `layouts/public`; every form includes `_csrf` hidden field; cards/tiles for points + coupons on `profile.ejs` render "เร็วๆ นี้" (Phase 4 placeholders) |

**Login:** `POST /member/login` compares `bcryptjs` against `customer_accounts.password_hash` where `status='active'`; on success uses `regenerateCustomerSession` (preserving any `req.session.user` per §4.3); rate-limited with the existing in-memory per-IP pattern from staff auth (acceptable here — cheap operation) plus `attempts` column on the account is out of scope; keep it simple: IP window only.

**Reuse summary (must, not optional):** `toWaPhone()`/`toJid()` (`src/utils/waPhone.js`), `sendTextMessage()` (`src/services/whatsappService.js`), `bcryptjs` (already a dep; used by `authController.js` — use **bcryptjs**, not the separate `bcrypt` package, to stay consistent with staff auth), shared `express-session` middleware + MySQL store, `i18nMiddleware`/`t()`, global `csurf`, `companySettingsService`, `findBestShippingRate()` (Phase 1a, reused by the member-facing "คำนวณ" from profile later).

**Genuinely new:** `customer_accounts`, `customer_otp_codes`, `customers.phone_normalized` (+ backfill script), `customerAuth.js`, `otpService.js`, `memberController.js` + `routes/member.js` + all `views/member/*`.

---

## 5. Phase 2 — Partner-shop directory (+ reviews)

### 5.1 `directory_shops` — new table (deliberately NOT `freight_partners`)

`freight_partners` is the internal credit/billing relationship (`credit_days`, `credit_limit_thb`, `tax_id`, `status` active/inactive/suspended). Coupling public marketing/content-moderation fields to it would (a) force column-allowlisting on every public query and (b) turn a financial-admin table into a CMS. Keep the concerns separate; add an optional soft-link for staff convenience only.

`database/migrate_026_directory_shops.sql` (register **before** `migrate_021` in `SQL_FILES`):
```sql
CREATE TABLE IF NOT EXISTS directory_shops (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  freight_partner_id BIGINT UNSIGNED NULL COMMENT 'optional soft link to freight_partners.id; staff convenience only',
  name VARCHAR(200) NOT NULL,
  business_type VARCHAR(100) NOT NULL DEFAULT '' COMMENT 'e.g. เสื้อผ้า, อาหาร, เครื่องสำอาง',
  description TEXT NULL,
  photo_path VARCHAR(255) NULL,
  city VARCHAR(120) NULL,
  province VARCHAR(120) NULL,
  phone VARCHAR(30) NULL,
  status ENUM('draft','published','hidden') NOT NULL DEFAULT 'draft',
  sort_order INT NOT NULL DEFAULT 0,
  created_by INT UNSIGNED NULL,          -- staff users.id
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ds_status_sort (status, sort_order),
  INDEX idx_ds_freight_partner (freight_partner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```
- **Never expose** `freight_partners` financial columns publicly; public queries hit only `directory_shops` (+ optionally `LEFT JOIN freight_partners ON ...` for nothing — no, do not join it at all in public routes).

`shop_reviews` — same migration:
```sql
CREATE TABLE IF NOT EXISTS shop_reviews (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  shop_id BIGINT UNSIGNED NOT NULL,
  customer_account_id BIGINT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL COMMENT '1-5',
  comment TEXT NULL,
  status ENUM('pending','published','rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  moderated_by INT UNSIGNED NULL,
  moderated_at TIMESTAMP NULL,
  UNIQUE KEY uq_review_once (shop_id, customer_account_id),
  INDEX idx_rev_shop_status (shop_id, status),
  CONSTRAINT fk_rev_shop FOREIGN KEY (shop_id) REFERENCES directory_shops(id),
  CONSTRAINT fk_rev_account FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id),
  CONSTRAINT fk_rev_moderator FOREIGN KEY (moderated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 5.2 Routes / controllers / views

| File | Action | Routes |
|---|---|---|
| `src/controllers/shopsDirectoryController.js` | NEW | staff: `listShopsAdmin`, `showCreate`/`createShop`, `editShop`/`updateShop`; public: `listPublished`, `showShop` |
| `src/routes/shopsDirectory.js` | NEW | staff: `GET/POST /admin/shops`, `GET /admin/shops/new`, `GET /admin/shops/:id/edit`, `POST /admin/shops/:id`, all `requireLogin`+`requireRole(['admin','manager'])`; public: `GET /shops` (published, by city/province filter), `GET /shops/:id(\d+)` (published only, else 404) |
| `src/routes/member.js` | MODIFY | add `POST /member/reviews` (auth+verified), `POST /member/reviews/:id/delete` (own review only) |
| Image upload | Use the existing `src/config/upload.js` multer pattern (same as orders/sticker uploads) → `public/uploads/shops/` |
| `views/shops/*.ejs` admin + `views/public/shops/*.ejs` public | NEW | grid card list + detail page with review form/list; moderation queue at `GET /admin/shops/reviews` (new handler `listPendingReviews`, `POST /admin/shops/reviews/:id/approve|reject`) |

### 5.3 Review eligibility (default applied)

- **Default: any logged-in, phone-verified member** may review; `status='pending'` until a staff member publishes. `UNIQUE(shop_id, customer_account_id)` enforces one review per member per shop (second attempt → user-friendly error).
- **Known gap (documented, not hidden):** nothing in the order model today ties an order to a *specific originating shop*, so "verified past customer of *this* shop" cannot be enforced at DB level. The moderation queue compensates. Closing the gap properly = adding shop-tagging to orders (out of scope; owner decision, see §7.2).

---

## 6. Phase 3 — Thai product price-check / buy-agent service

### 6.1 Recommended approach: manual quote-request form (NOT live scraping)

- The internal `partner_quotations` table + `partnerController` already implement the *fulfillment* side of exactly this workflow: staff price a product from a customer (`product_url`, `product_price_thb`, `shipping_th_thb`, `weight_kg`, `exchange_rate`, `fx_spread_pct`, `sng_shipping_lak`, `service_fee_lak`, `subtotal_thb`, `total_lak`, status, `order_id`), and confirm via WhatsApp.
- **New `product_quote_requests`** (public intake only — captures customer *intent*, no pricing fields; pricing stays staff-computed in `partner_quotations`):
  `database/migrate_027_product_quote_requests.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS product_quote_requests (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    customer_account_id BIGINT UNSIGNED NOT NULL,
    product_url TEXT NULL,
    product_name VARCHAR(500) NOT NULL,
    desired_qty SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    note TEXT NULL,
    status ENUM('new','in_progress','quoted','closed') NOT NULL DEFAULT 'new',
    linked_quotation_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_pqr_account (customer_account_id),
    INDEX idx_pqr_status (status),
    CONSTRAINT fk_pqr_account FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id),
    CONSTRAINT fk_pqr_quotation FOREIGN KEY (linked_quotation_id) REFERENCES partner_quotations(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  ```
- **Member flow (Phase 3):** `GET/POST /member/quote-request` (auth+verified) → saves request → status `new`.
- **Staff flow:** small addition to the existing `/partner` dashboard (`src/controllers/partnerController.js` + `views/partner/*.ejs`): a "คำขอใบเสนอราคา" queue listing `product_quote_requests WHERE status IN ('new','in_progress')`; button "สร้างใบเสนอราคา" pre-fills `partnerController.newForm` (`product_url`, `product_name`, customer `name/phone` from the linked `customer_accounts`), links the created quotation back (`UPDATE product_quote_requests SET linked_quotation_id=?, status='quoted'`). Staff then replies over WhatsApp using the existing `sendTextMessage()` — no new messaging infrastructure.
- **Live scraping (Lazada/Shopee) is explicitly NOT the default**: ToS violations, anti-bot maintenance burden, and real legal exposure. Only revisit if a licensed data source is already in hand (§7.1).

---

## 7. Open Decisions (defaults applied — revisit with owner before the phase builds)

1. **Price-check mechanism** — DEFAULT: manual quote-request form feeding `partner_quotations` (§6). Alternatives if owner chooses: (a) partner-shop self-managed catalog upload (new CMS + moderation, medium effort), (c) live scraping (flag: high legal/ToS/technical risk — not recommended).
2. **Review eligibility** — DEFAULT: any phone-verified member, moderated. Tighter option (only members with an order at that shop) requires order↔shop tagging — new scope. Looser option (any visitor, captcha) — spam risk. Easy to loosen later, hard to tighten — hence the strict default.
3. **Directory table shape** — DEFAULT: dedicated `directory_shops` (§5.1), not extending `freight_partners`.
4. **"App-like" feel** — the reference (HAL Express) is a native app; this stack is server-rendered EJS with full-page nav (no client router exists). Phase 1a includes **PWA manifest + service worker** (`public/manifest.webmanifest`, `public/sw.js` — static-asset cache, "Add to Home Screen") as cheap partial mitigation. **htmx** for partial-page swaps (calculator recalc, OTP countdown, nav transitions) would get closer to app-like but is new tooling — not assumed; owner decides before Phase 1a UI polish.
5. **WhatsApp-down = registration/reset unavailable, no SMS fallback** — accepted limitation per the owner's explicit "OTP via WhatsApp only" requirement. Mitigation scoped by default: friendly retry message + the OTP row stays valid. A status page or SMS gateway would be new scope, not assumed.
6. **Loyalty mechanics (Phase 4)** — genuinely undecided: how points are earned/redeemed, what coupons discount, referral reward amounts, lucky-draw rules. **Phase 4 starts with the owner defining the rules — not with code.** `customer_accounts.referral_code` + `referred_by_account_id` (Phase 1b) already lay the groundwork for referral without committing to mechanics.

---

## 8. Risks & mitigations

| Risk | Assessment / mitigation |
|---|---|
| 532 KB unoptimized logo on public mobile | Replaced in portal by script-generated compact assets (`sng-logo-nav.png`, favicon set). Original kept for admin. |
| No favicon | Added in 1a to both public + admin layouts. |
| OTP abuse burning WhatsApp quota / harassing phones | DB-backed rate limits (§4.4) — mandatory because multi-worker Passenger breaks in-memory counters. Per-phone + per-IP windows keyed on shared tables. |
| `WHATSAPP_NOT_READY` during OTP | Friendly retry; row stays valid; not counted against limits (§4.4). |
| Staff/customer session collision | Same shared session store; separate namespaces (`req.session.user` vs `req.session.customer`); both regenerate helpers re-copy the other namespace (§4.3). Explicit, tested in verification. |
| Leaking financial data via public routes | Public queries touch only `directory_shops`, never `freight_partners`/`space_bookings`; calculator exposes only price/rate name; `/member/orders` gated behind OTP-verified phone ownership. |
| Status labels breaking in Lao | 1a extends `status.*` in both dicts (§3.5) so the re-themed timeline never shows raw keys. |
| Migration ordering | New migrations (`025, 026, 027`) inserted **before** `migrate_021_role_enum_canonical.sql` in `scripts/migrate_db.js`'s `SQL_FILES` — that file must stay last. |
| Extracting `findBestShippingRate` changes internal pricing | Requirement: internal `GET /api/shipping-price` output must remain byte-identical after refactor; verify in 1a with before/after curl. |
| Server-rendered vs native-app expectation | PWA manifest + SW in 1a; htmx is an owner decision (§7.4). Scope callout, not a blocker. |

---

## 9. Verification plan

Run the project's existing checks after **each** phase: `npm run lint`, `npm test`, `npm run check-db` (then `npm run migrate-db` after adding each new migration file).

### Phase 1a
- Load `/`, `/track`, `/calculate` logged-out: no redirect to `/login` anywhere.
- Staff session still lands on `/dashboard` for `/`; staff hitting an unknown URL still lands on `/dashboard`.
- Tracking search submits and renders; invalid `jobNo` shows friendly error; timeline order + internal-note filtering unchanged.
- Lao toggle (`?lang=lo`) flips home, tracking, calculator; no raw `status.*` keys leak in either language.
- `/api/public/shipping-quote` returns same price as the internal `/api/shipping-price` for identical inputs (before/after refactor comparison).
- Throttled mobile viewport: nav logo + favicon load measurably faster than original 532 KB asset.
- `npm run lint` + `npm test` green.

### Phase 1b
- Full signup → OTP received on a real WhatsApp-registered TH test number → verify → lands on `/member/profile`.
- Wrong OTP lockout after `max_attempts`; resend cooldown 60 s enforced; per-phone 10-min cap enforced (attempt from two "different" client IPs still blocked — proves DB-backed limit).
- Forgot-password end-to-end on the same number.
- **Staff + customer in one browser:** login staff (`/dashboard`), then open `/member/login` and login (or register) as customer → both stays logged in; customer logout leaves staff session intact, and vice-versa.
- `/member/orders` lists orders where `customers.phone_normalized` matches (sender or receiver); the member cannot see orders for other phones.
- `npm run lint`, `npm test`, `npm run check-db` green.

### Phase 2
- Staff publishes a shop → appears on `/shops` + `/shops/:id`; draft/hidden shops 404 publicly.
- Verified member submits review → `pending`; staff approves → `published`; second review by same member on same shop rejected (UNIQUE).
- Unauthenticated/unverified review POST → redirect to login (or 403).
- `npm run lint`, `npm test`, `npm run check-db` green.

### Phase 3
- Member submits quote request → appears in `/partner` queue → staff converts → `partner_quotations` row pre-filled + request marked `quoted` → WhatsApp reply sent via existing `sendTextMessage`.
- `npm run lint`, `npm test`, `npm run check-db` green.

---

## 10. Execution checklist for @sixth

1. Read the verified source files listed in §1 before touching them (esp. `src/app.js`, `src/middleware/auth.js`, `src/controllers/settingsController.js`, `src/services/pricingService.js`, `src/controllers/trackingController.js`, `views/tracking/index.ejs`, `views/layouts/main.ejs`).
2. Implement phases strictly in order 1a → 1b → 2 → 3.
3. **Phase 4 is gated on the owner defining loyalty business rules — do not design it unilaterally.**
4. Register every new migration in `scripts/migrate_db.js` **before** `migrate_021_role_enum_canonical.sql`.
5. Never write to `req.session.user` from any public/member controller. Never expose `freight_partners`, `space_bookings`, `users`, or `crm_*` tables in public queries.
6. Keep the gold/black portal theme isolated in `public/css/portal.css`; do not restyle `luxury.css` admin components.
7. Run §9 verification after every phase; report results faithfully, including any failures.
