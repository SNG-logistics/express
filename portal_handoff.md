# Public Customer Portal — Handoff (Phase 1a)

Claude Code hit its usage limit mid-task. Owner is routing this to the next
available agent (Antigravity / Gemini 3.6 Flash) to continue. This doc is
self-contained — read this before touching code, no other conversation
context is available to you.

**Repo**: `C:\Users\acer\OneDrive\เดสก์ท็อป\httpdocs` (SNG Logistics — Node/Express
4 + EJS + MySQL, Thailand↔Laos parcel shipping). ESM (`"type":"module"`), no
build step. Do **not** commit or push — the owner reviews and commits
manually once satisfied.

Full approved plan (all 4 phases): `C:\Users\acer\.claude\plans\webapp-ui-linear-rose.md`.
This doc only covers finishing **Phase 1a** (public pages, no auth, no new
tables) — Phase 1b+ (member accounts/OTP, shop directory, etc.) is not
started and not in scope until Phase 1a is verified.

## Why this exists

SNG had **zero public web presence** — `/` always redirected to staff
login. The owner wants a public portal (tracking, shipping calculator, shop
directory, etc.) themed in the company's gold-on-black brand, modeled loosely
on a competitor app ("HAL Express") for information architecture only, not
its red/white palette. Two other agents (@sixth, then Claude Code) have
worked this in sequence, each picking up where the last left off after
hitting a limit — you're the third.

## Current state: what's DONE (do not redo)

**Wired up and working:**
- `src/app.js` — `/` is now session-aware: staff (`req.session.user` set) →
  `/dashboard` as before; everyone else → `publicController.home`. Catch-all
  404 similarly splits staff (redirect `/dashboard`) vs public (render
  `errors/404-public` on `layouts/public`). `publicRoutes` mounted. Verified
  with `node --check src/app.js`.
- `src/routes/public.js`, `src/controllers/publicController.js` — routes:
  `GET /calculate` (SSR shipping calculator page), `GET /shops` (coming-soon
  placeholder — Phase 2 not started), `GET /api/public/shipping-quote`
  (JSON, rate-limited via `publicRateLimit` in `src/middleware/auth.js`).
- `src/services/pricingService.js` — new `findBestShippingRate()`, extracted
  from `settingsController.calculatePrice` with **zero behavior change** to
  the existing internal `/api/shipping-price` consumer (verified by diff).
- `src/services/companySettingsService.js` — new, wraps `company_settings`
  key-value table reads (`getCompanySettings()`, `getCompanyBilingual()`).
- `views/layouts/public.ejs` — shared public shell: Noto Sans Thai/Lao +
  Prompt fonts, Tailwind Play CDN (`preflight:false`) + Alpine.js + Font
  Awesome, `public/css/portal.css`, flash messages, registers `/sw.js`.
  **References favicon/logo files that don't exist yet** — see Task 2 below.
- `views/components/public-navbar.ejs` — top bar (logo, lang toggle, account
  link) + bottom tab nav (Home/Track/Calculate/Shops/Account). **Already
  links `/track`** — no navbar changes needed for Task 1.
- `views/public/home.ejs`, `views/public/calculate.ejs`,
  `views/public/coming-soon.ejs`, `views/errors/404-public.ejs` — all built
  on `layouts/public`, all use `t()` for text (no raw-key leakage).
- `public/css/portal.css` — complete gold/black theme (`--portal-gold:#FFE000`,
  `--portal-bg:#0a0a0a`, etc.) — `.portal-shell`, `.card`, `.btn-gold`,
  `.input-portal`, `.shortcut-grid`, `.bottom-nav`, `.portal-topbar`,
  `.empty-state`, `.portal-flash`, `.quote-result`, `.portal-form` all
  defined. Reuse these classes — don't invent new ones without checking here
  first.
- `public/manifest.webmanifest`, `public/sw.js` — PWA basics, reference icon
  paths that don't exist yet (Task 2).
- `src/middleware/auth.js` — added `publicRateLimit()` (in-memory sliding
  window, fine for this low-cost endpoint). Also hardened
  `regenerateSession()` to preserve `req.session.customer` across
  regenerate, so a future customer-session concept (Phase 1b) won't get
  wiped by a staff login regenerate in the same browser — already done, not
  yet used by anything (no customer sessions exist yet).
- `src/i18n/th.json` / `src/i18n/lo.json` — added the 10 `status.*` keys
  that were missing (canonical wording from `src/constants/statuses.js`'
  `ORDER_STATUS_LABELS`) and a full 26-key `portal.*` namespace, in both
  files, both validated as parseable JSON.
- `views/public/home.ejs` — **just fixed**: `company_settings` uses a
  `_th`/`_la` suffix convention (country entity) but the i18n language code
  is `th`/`lo` — `'lo' !== 'la'` meant Lao viewers silently saw Thai company
  name/address. Fixed via a local `companySuffix = lang === 'lo' ? 'la' : 'th'`
  computed at the top of the file, used in both footer lookups. If you build
  anything else that reads `company_settings` by language, use this same
  mapping — don't reuse `lang` directly as the suffix.

**i18n fallback behavior** (`src/middleware/i18n.js`): `t(key)` = dict value
→ else Thai fallback → else the raw dotted key string. A missing key doesn't
error, it **visibly renders as broken text** (e.g. `tracking.title` literally
on the page). Always add both `th.json` and `lo.json` keys together and
grep the rendered page mentally before calling a view done.

`res.locals.t` is set by `i18nMiddleware`, mounted globally at
`src/app.js:224` — this runs before every route including `/track`
(`src/app.js:445-446`), so **controllers can call `res.locals.t('key')`
directly**, not just views.

## Task 1 — IN PROGRESS: re-theme `views/tracking/index.ejs`

This is the page a customer lands on scanning the QR code on a shipping
sticker. Right now it's a fully standalone HTML document (own
`<!DOCTYPE html>`, own inline `<style>` block, Inter font with **no Thai
glyph coverage** despite being 100% Thai text, cyan/purple admin-tool
colors) rendered with `layout: false`. It needs to move onto the same
`layouts/public` shell as the rest of the portal and support the Lao toggle.

**Read first**: `views/tracking/index.ejs` (the current file, ~348 lines),
`src/controllers/trackingController.js` (~104 lines, 3 functions:
`trackOrder`, `trackLanding`, both call `res.render('tracking/index', {...})`
— 4 render call-sites between them, all currently pass `layout: false`),
`src/constants/statuses.js` (`ORDER_STATUS_LABELS` — object keyed by status
code, each value `{ label: 'Thai text', cssClass: 'new'|'received'|...}`).
Also skim `views/public/calculate.ejs` as the closest existing example of a
`layouts/public`-based page with a form + result card, to match its
structure/class usage.

**Step 1 — add i18n keys.** Add a new `tracking` namespace to both
`src/i18n/th.json` and `src/i18n/lo.json` (put it near the existing
`order`/`status` blocks). Thai wording (translate to Lao yourself for
`lo.json`, matching the tone of the existing `lo.json` `portal.*` block):

```json
"tracking": {
  "title": "ติดตามพัสดุ",
  "subtitle": "ขนส่งไทย-ลาว ติดตามพัสดุ",
  "searchLabel": "ค้นหาหมายเลขพัสดุ",
  "searchPlaceholder": "เช่น SNG-260417-1234",
  "notFoundPrefix": "ไม่พบพัสดุหมายเลข",
  "systemError": "เกิดข้อผิดพลาดในระบบ กรุณาลองอีกครั้ง",
  "emptyTitle": "กรอกหมายเลขพัสดุเพื่อติดตามสถานะ",
  "emptyHint": "สแกน QR Code บนใบปะหน้าหรือพิมพ์เลข SNG-XXXXXX",
  "destination": "ปลายทาง",
  "codLabel": "เก็บเงินปลายทาง (COD)",
  "createdAt": "วันที่สร้าง",
  "updatedAt": "อัปเดตล่าสุด",
  "history": "ประวัติสถานะ"
}
```

Reuse existing keys where they already fit instead of duplicating: `order.sender`,
`order.receiver`, `order.weight`, `order.thToLa`, `order.laToTh`,
`common.search` all already exist in both files.

**Step 2 — controller.** In `src/controllers/trackingController.js`, for all
4 `res.render('tracking/index', {...})` call sites:
- Change `layout: false` → `layout: 'layouts/public'`.
- Replace the hardcoded Thai `title:` strings with calls to
  `res.locals.t('tracking.title')` (plus the job_no where the original
  interpolated it).
- Replace the hardcoded Thai `error:` strings — `` `ไม่พบพัสดุหมายเลข "${jobNo}"` ``
  → `` `${res.locals.t('tracking.notFoundPrefix')} "${jobNo}"` ``, and the
  catch-block's generic error → `res.locals.t('tracking.systemError')`.
- Everything else (SQL, internal-note log filtering, `ORDER_STATUS_LABELS`
  import) stays exactly as-is — don't touch the query logic.

**Step 3 — rewrite the view.** In `views/tracking/index.ejs`:
- Delete the `<!DOCTYPE html><html><head>...</head><body>` wrapper and the
  entire inline `<style>` block — `layouts/public.ejs` now supplies the
  document shell, fonts, and CDN links.
- Rebuild the search box, order card, status badge, info grid, and timeline
  using `public/css/portal.css` classes (`.portal-shell`, `.card`,
  `.input-portal`, `.btn-gold`, `.empty-state`, etc. — check that file for
  the full list before inventing new class names).
- Swap `statusInfo.label` (Thai-only, from the `statusLabels` prop) for
  `t('status.' + order.status)`. **Keep** `statusInfo.cssClass` from the
  `statusLabels` prop for the badge's color class — that's a CSS class name,
  not user-facing text, no i18n needed.
- Same swap in the timeline loop: `logLabel` currently reads
  `statusLabels[log.to_status]?.label` → change to
  `t('status.' + log.to_status)`.
- Replace remaining hardcoded Thai microcopy (labels, empty state, footer)
  with the new `t('tracking.*')` keys from Step 1 and the existing
  `t('order.*')` keys.
- Keep the search form's `action="/track" method="GET"` and `name="q"`
  attributes exactly as they are — `views/public/home.ejs`'s hero search
  form targets this same endpoint and param name.
- `fmtDate()` hardcodes the `'th-TH'` locale for
  `toLocaleDateString`/`toLocaleTimeString` — decide whether to switch to
  `lang === 'lo' ? 'lo-LA' : 'th-TH'`; test that Node's built-in ICU
  actually supports `lo-LA` formatting before relying on it, since a Node
  build without full-icu can silently fall back to `en-US`-style output.

**Step 4 — smoke test manually** (dev server, no test framework covers
views): visit `/track` (empty state), `/track/SOME-INVALID-CODE`
(not-found state), `/track/<a-real-job_no-from-the-orders-table>` (success
state with timeline) — each once with `?lang=th` and once with `?lang=lo`.
Confirm no raw `tracking.*`/`status.*`/`order.*` key strings appear anywhere
on the page (that exact bug class is what task #22 caught in `home.ejs` —
see the fix above for the pattern of what to watch for).

No navbar or home-page changes needed — both already link to `/track`.

## Task 2 — PENDING, not started: generate brand assets

Only `public/images/snglogo.png` exists (532KB — too heavy for a public
mobile page) and there is **no favicon anywhere in the repo**. The following
paths are already referenced by code but currently 404:

- `/favicon/favicon.ico` (`views/layouts/public.ejs:10`)
- `/favicon/favicon-32x32.png` (`views/layouts/public.ejs:11`)
- `/favicon/apple-touch-icon-180x180.png` (`views/layouts/public.ejs:12`)
- `/favicon/android-chrome-192x192.png` (`public/manifest.webmanifest`)
- `/favicon/android-chrome-512x512.png` (`public/manifest.webmanifest`)
- `/images/sng-logo-nav.png` (`views/components/public-navbar.ejs:4`)

Approach:
1. `npm install --save-dev sharp`.
2. Write `scripts/generate_brand_assets.mjs` — a one-off Node script that
   reads `public/images/snglogo.png` and uses `sharp` to emit all 6 files
   above at the right sizes (nav logo: small, e.g. ~120px tall; favicon.ico
   needs multi-size embedding — `sharp` alone doesn't write `.ico` directly,
   you likely need to generate the PNG sizes with `sharp` and a small
   ico-encoding step, or add a second tiny dependency like `png-to-ico` —
   check what's already available before adding another package).
3. Run it once: `node scripts/generate_brand_assets.mjs`. The generated
   files are real build output, not source — fine to commit per this repo's
   existing convention (check how other generated/static assets under
   `public/` are handled, e.g. `git status` today shows `public/css/portal.css`
   etc. as regular untracked files, not gitignored).

## After both tasks: verification (Phase 1a is not "done" until these pass)

- `npm run lint`, `npm test`, `npm run check-db` all still pass.
- Load `/`, `/track`, `/calculate` while logged out — confirm none of them
  redirect to `/login`.
- Toggle `?lang=lo` on all of `/`, `/track`, `/calculate`, `/shops` —
  confirm every string switches language, zero raw dotted-key strings
  visible anywhere.
- Submit the tracking search and the shipping calculator with both valid
  and invalid input.
- `/api/public/shipping-quote` output matches the existing internal
  `/api/shipping-price` output for identical query params (same underlying
  `findBestShippingRate()` now, should be byte-identical pricing).
- Quick mobile-viewport pass once brand assets exist, to confirm the new
  optimized logo/favicons actually load faster than the original 532KB PNG.

Do not start Phase 1b (member accounts + WhatsApp OTP) or later phases —
per the approved plan, those wait until Phase 1a is fully verified, and
Phase 1b in particular needs the owner's sign-off on OTP abuse-control
design before any code lands (see the plan file's Phase 1b section for the
full spec — DB-backed rate limiting is mandatory there because the app runs
under Phusion Passenger with multiple worker processes, unlike the
in-memory `publicRateLimit` used in Phase 1a, which is fine for its lower
stakes).
