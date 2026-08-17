# Billing Statements (Net-off) — Frontend Hand-off

Backend is done and migrated on the local dev DB. This doc is the full contract for
the two remaining pieces so neither agent needs to read the backend files — just
this doc + the one reference file listed per task.

**Do not touch:** `database/migrate_022_billing_statements.sql`,
`src/models/billingModel.js`, `src/controllers/billingController.js`,
`src/routes/billing.js`, `src/app.js`, `src/controllers/ordersController.js`,
`src/i18n/*.json`, `views/components/sidebar.ejs`. All already wired and tested
(migration ran clean on local DB, app boots, no route conflicts).

Business rules already enforced server-side (informational only, don't re-implement):
- `payment_method` on an order is now `'ORIGIN' | 'DESTINATION' | 'MONTHLY_BILL'`.
- `MONTHLY_BILL` is only valid when the **sender** customer has `is_credit = 1`
  (server rejects otherwise — client-side hiding of the option is a UX nicety, not the guard).
- A statement only ever includes orders whose COD (if any) is already `COLLECTED`,
  or which have no COD and are `DELIVERED`. Settling a statement bulk-closes every
  included order. None of this needs re-deriving — just render what the controller gives you.

---

## Task A (Codex) — 3 files

### A1. `views/orders/new.ejs` — add the MONTHLY_BILL radio option

Reference block already in the file, around **line 580-589**:

```html
<div class="flex gap-4">
  <label class="flex items-center gap-2 cursor-pointer">
    <input type="radio" name="payment_method" value="ORIGIN" x-model="paymentMethod" ...>
    <span class="text-sm text-slate-300">จ่ายต้นทาง (ผู้ส่งจ่าย)</span>
  </label>
  <label class="flex items-center gap-2 cursor-pointer">
    <input type="radio" name="payment_method" value="DESTINATION" x-model="paymentMethod" ...>
    <span class="text-sm text-slate-300">จ่ายปลายทาง (ผู้รับจ่าย)</span>
  </label>
</div>
```

Add a third radio for `MONTHLY_BILL`, shown only when the selected sender is
credit-approved. The `customers` array passed to this view now includes
`is_credit` (0/1) per row — was just `id, name, type, phone, country` before,
now has `is_credit` too. The Alpine component is `orderWizard()` (`x-data="orderWizard()"`,
top of file ~line 26) and already tracks `senderId` in its state (set via the
`customerSearch('sender', ...)` sub-component near line 193). Add a computed/inline
check such as `customers.find(c => c.id === senderId)?.is_credit` — you'll need to
serialize `customers` into the Alpine state (`x-data`) if it isn't already available
there; check how `shippingRates` or similar server data currently reaches Alpine state
in this same file for the existing pattern.

```html
<label class="flex items-center gap-2 cursor-pointer" x-show="<your is_credit check>">
  <input type="radio" name="payment_method" value="MONTHLY_BILL" x-model="paymentMethod" ...>
  <span class="text-sm text-slate-300">วางบิล (Monthly Bill)</span>
</label>
```

Do the same in `views/orders/edit.ejs` (reference block ~line 143-148, same radio
pattern, `order.payment_method === 'MONTHLY_BILL' ? 'checked' : ''`). That view's
`customers` array also now includes `is_credit`.

### A2. `views/billing/index.ejs` (new file) — statement list + create form

Route: `GET /billing` → `billingController.index`. Data passed to the view:

```js
{
  title: string,
  statements: [{
    id, customer_id, period_start, period_end,
    total_cod, total_shipping, net_amount,   // net_amount > 0 = SNG owes customer, < 0 = customer owes SNG
    status: 'OPEN' | 'SETTLED',
    created_by, settled_by, settled_at, created_at,
    customer_name,
  }],
  creditCustomers: [{ id, name, phone }],   // only is_credit=1 customers, for the "create statement" dropdown
  filterCustomerId: string | null,
  error: null,
}
```

Build:
- A table of `statements` (customer name, period, total_cod, total_shipping, net_amount
  with a color/badge for positive vs negative, status badge, link to `/billing/:id`).
- A "สร้างใบวางบิล" form: `<form method="POST" action="/billing/statements">` with a
  `customer_id` select (from `creditCustomers`), `period_start` and `period_end` date
  inputs. No other fields — the backend computes everything else from those three.
- Follow the layout/nav conventions in `views/cod/index.ejs` (closest analog — same
  finance-module look, tab-less list+form page). Sidebar link and i18n key
  (`nav.billing` → "วางบิล" / "ວາງບິນ") already exist, page just needs to render under
  the existing layout.

### A3. `views/billing/show.ejs` (new file) — statement detail + settle button

Route: `GET /billing/:id` → `billingController.show`. Data: `{ title, statement, error }`
where `statement` is:

```js
{
  id, customer_id, period_start, period_end,
  total_cod, total_shipping, net_amount, status, created_by, settled_by, settled_at, created_at,
  customer_name, customer_phone, customer_address,
  items: [{ id, statement_id, order_id, shipping_fee, cod_amount, job_no, order_created_at }],
}
```

Build:
- Header: customer name/phone/address, period, status badge.
- Totals block: total_cod, total_shipping, net_amount (labelled clearly which
  direction money moves — see the Thai wording in `แผนงานวางบิลแบบเหมารอบ.md` step 4
  for the exact phrasing to reuse: "SNG ต้องคืนให้..." / "...ต้องเป็นคนโอนเงินให้ SNG").
- Table of `items` (job_no, order date, shipping_fee, cod_amount).
- If `statement.status === 'OPEN'`: a "ปิดบิล (Mark as Settled)" button/form —
  `<form method="POST" action="/billing/<%= statement.id %>/settle">` — with a strong
  confirm dialog (this bulk-closes every order listed; irreversible, same weight as
  the delete-order confirm() already used elsewhere in this app).
- A "พิมพ์ใบวางบิล" link to `/billing/:id/print` (opens Task B's template).

---

## Task B (Sixth) — 1 file, isolated from Task A

### B1. `views/billing/print.ejs` (new file) — A4 print statement

Route: `GET /billing/:id/print` → `billingController.print`, rendered with
`layout: false` (same convention as the existing order print views). Same
`statement` data shape as A3 above — reuse the exact object shape documented there,
you don't need to touch the controller.

Copy the structural pattern from **`views/orders/print.ejs`** (A4 sizing, `@media print`
rules, header/footer layout) — don't invent new print CSS, this repo already has a
working A4-fit pattern there. Two sections, clearly separated (per the original
billing plan doc): a COD line-item table and a shipping-fee line-item table, both
sourced from `statement.items` (`cod_amount` column and `shipping_fee` column
respectively), each with its own subtotal, then the net total at the bottom with
the same "who owes whom" phrasing used in A3.

---

## Verification (whoever finishes last)

1. `npm run migrate-db` already applied on local dev — no DB step needed.
2. Create a test order with `payment_method=MONTHLY_BILL` for a customer flipped to
   `is_credit=1` (there's no admin UI for `is_credit` yet — set it directly:
   `UPDATE customers SET is_credit=1 WHERE id=<test id>;`), push it to DELIVERED.
3. `/billing` → create a statement covering that order's date → `/billing/:id` shows
   it in the items table with correct net_amount → settle → order status becomes CLOSED.
4. `/billing/:id/print` renders and fits one A4 page.
