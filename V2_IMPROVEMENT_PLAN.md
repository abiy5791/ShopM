# ShopM v2 — Improvement Plan

> **Audience:** Claude Code (and human reviewers).
> **Purpose:** Close the gaps found in the v1 audit (2026-07-13) and bring the product to a professional, sellable standard. Same rules as v1's `IMPLEMENTATION_PLAN.md`: build phase by phase, each phase gated by its **Definition of Done (DoD)**, small conventional commits, tests as you go.

---

## 0. Audit summary — what v1 actually has vs. what's missing

v1 (Phases 0–8) delivered a solid foundation: multi-tenant shops, JWT + RBAC (owner/cashier), ledger-derived stock, idempotent offline-capable POS, purchases, expenses, customers + credit, reports with PDF/XLSX export, owner console, notifications, activity log, backups, prod Docker. The architecture is good. The gaps are in **enforcement, administration, and presentation**:

### Critical gaps (confirmed by code audit)

| # | Gap | Evidence |
|---|-----|----------|
| G1 | **Sales are not bound to live stock.** A sale of any quantity — including of an item at 0 stock — returns `201`, writes a `-qty` ledger row, and drives `stock_cached` negative. No availability check exists anywhere in the sale path, and no row lock prevents two concurrent sales of the last unit. | `apps/sales/services.py:23-103` (no stock read), `apps/sales/serializers.py:10-42` (only `quantity >= 1` + shop check), `apps/inventory/services.py:37-63` (no floor, no `select_for_update`) |
| G2 | **POS UI ignores stock.** Product cards show no stock on hand; add-to-cart is unconditional; the quantity stepper has no upper bound; the `stock` field copied into each cart line is never read. Out-of-stock items sell freely. | `frontend/src/features/pos/POSPage.tsx:196,346-353`, `frontend/src/features/pos/cartStore.ts:45-71` |
| G3 | **No staff management / account creation.** There is no user-creation API, no registration, no `ShopMembership` endpoint, and no staff UI. Owners cannot add cashiers, assign roles, deactivate accounts, or reset passwords except via Django admin/CLI. | grep: `create_user` only in `accounts/managers.py`; no membership viewset; `GET /me` is the only membership read |
| G4 | **No branch (shop) management.** `ShopViewSet` is read-only; there is no API or UI to create, rename, or edit a branch. The shop switcher can only switch between seeded shops. | `apps/shops/views.py:16`, `frontend/src/app/layout/ShopSwitcher.tsx` |
| G5 | **Reports have no charts and no quick date ranges.** No charting library is installed; every report is KPI cards + a plain table. Date filtering is two bare `<input type="date">` fields — no "Today / This week / This month" one-click ranges. | `frontend/package.json` (no chart lib), `frontend/src/features/reports/ReportsPage.tsx:103-191` |

### Secondary gaps (professional polish)

| # | Gap | Evidence |
|---|-----|----------|
| P1 | No mobile navigation — sidebar is `hidden md:flex` with no hamburger/drawer replacement; app is un-navigable on phones | `frontend/src/app/layout/Sidebar.tsx:16` |
| P2 | Destructive actions use browser `window.confirm()` instead of styled AlertDialogs | `ProductsPage.tsx:112`, `ExpensesPage.tsx:33`, `SalesPage.tsx:37-42` |
| P3 | Customers list has **no pagination** (renders first API page only); other lists are Prev/Next-only | `frontend/src/features/customers/CustomersPage.tsx` |
| P4 | Error states conflated with empty states; no Retry button anywhere | e.g. `ProductsPage.tsx:260-261` |
| P5 | Offline outbox **silently drops** server-rejected sales on replay — data loss with no trace in UI | `frontend/src/features/pos/api.ts:135-138` |
| P6 | Demo credentials hardcoded on the login screen | `frontend/src/features/auth/LoginPage.tsx:150-154` |
| P7 | `ShopSettings.low_stock_default` is never applied — new products get `min_stock_alert = 0`, so low-stock alerts effectively fire only at 0 | `apps/catalog/models.py` (`min_stock_alert` default 0) |
| P8 | Negative manual stock adjustments can push stock below zero (only `quantity != 0` is enforced) | `apps/inventory/serializers.py:42` |
| P9 | Dashboard `cash_balance` is all-time, not period-scoped — misleading next to "today" KPIs | `apps/reports/services.py:68-76` |
| P10 | `Payment.amount` accepts 0 | `apps/sales/serializers.py:19-20` |
| P11 | Role rows (`owner`/`cashier`) are created only by the seed command, not by migration — fresh DBs have no roles | `apps/accounts/migrations/0001`, `seed.py:140-141` |
| P12 | Two parallel frontend type sources (hand-written `types/index.ts` + generated `types/api.ts`) — drift hazard | `frontend/src/types/index.ts:1-9` |
| P13 | E2E test asserts `Charge $` while the app defaults to ETB — currency mismatch | `frontend/e2e/critical-path.spec.ts:19` |
| P14 | Hand-rolled tab/checkbox controls instead of shadcn primitives; duplicated role-lookup logic in ~6 files | `ReportsPage.tsx:69-101`, `POSPage.tsx:258` |

---

## 1. Locked decisions for v2

1. **Out-of-stock = not sellable.** Definition: available stock for a product = `stock_cached` (ledger-backed). A sale line with `quantity > available` is rejected server-side; the POS prevents it client-side first. Stock can never go below zero via a *sale*. (Void/return compensating rows are unaffected.)
2. **Server is the gate, POS is the guard.** Client-side checks are UX; the DB transaction with row locks is the enforcement. Both are required.
3. **Offline sales can still be rejected on sync** (stock may have changed while offline). Rejected sales are **never silently dropped** — they land in a visible "failed sync" queue for owner review.
4. **Staff accounts are owner-created.** No self-registration. An owner creates a cashier (name, email, password) and assigns them to one or more of *their own* branches with a role. Owners cannot touch users outside their shops.
5. **Charts use Recharts** (React-native, tree-shakeable, plays well with Tailwind/shadcn). One shared chart-theme module; consistent colors in light and dark mode.
6. All existing v1 locked decisions (ledger-derived stock, integer minor-unit money, soft-delete + audit, idempotent sales) remain in force.

---

## 2. Phase A — Stock integrity (bind selling to live stock) 🔴 highest priority

**Goal:** It is impossible to sell what isn't there — enforced in the DB transaction, reflected in the POS.

### Backend
- [ ] In `create_sale` (`apps/sales/services.py`): inside the atomic block, lock the sale's product rows with `select_for_update()`, compute availability, and reject any line where `quantity > stock_cached` with the standard error envelope, e.g. `{"detail": "Insufficient stock", "code": "insufficient_stock", "fields": {"<product_id>": {"requested": 5, "available": 2}}}`.
- [ ] Add a defensive floor in `record_transaction` for `type=sale`: raise if the resulting stock would go negative (belt-and-braces behind the service-level check).
- [ ] Manual adjustments (`StockAdjustView`): reject negative adjustments that would take stock below zero (`code: "adjustment_below_zero"`), with a clear message showing current stock.
- [ ] Keep voids/returns unaffected (compensating rows add stock back).
- [ ] Tests: oversell rejected (qty > stock); exact-stock sale succeeds and leaves 0; sale at 0 stock rejected; **concurrent last-unit test** (two threads, one succeeds, one gets `insufficient_stock`); negative adjustment floor; void still restores stock.

### Frontend (POS)
- [ ] Product cards show stock on hand: quantity badge, amber "Low" badge when `stock <= min_stock_alert`, red "Out of stock" badge + dimmed/disabled card when `stock <= 0`.
- [ ] `cartStore.add()` refuses to exceed available stock (uses the already-stored `stock` per line); the `+` stepper and direct qty entry clamp to stock with a toast ("Only N left in stock").
- [ ] Barcode/SKU Enter on an out-of-stock item shows a toast instead of adding.
- [ ] A "hide out-of-stock" toggle on the POS catalog (default off, so cashiers still *see* items exist).
- [ ] After a completed sale, refresh the cached catalog so displayed stock stays current; on server `insufficient_stock` rejection, show which lines failed and keep the cart intact for correction.
- [ ] Offline: keep the same client-side clamps against last-known stock; label stock values as possibly stale when offline (per v1 §10.5).

### Offline outbox — no silent loss
- [ ] Replace the silent drop in `pos/api.ts:135-138`: on a non-network rejection, move the sale to a persistent **`failed` queue** in IndexedDB (never auto-delete).
- [ ] POS header badge shows failed count; a review panel lets the user see the rejection reason, retry (after stock arrives), or explicitly discard (logged).
- [ ] Fire an owner notification when an offline sale fails to sync.

**DoD**
- [ ] `POST /sales` for qty > available returns 400 `insufficient_stock`; concurrent last-unit test proves only one sale wins.
- [ ] In the POS, an out-of-stock product visibly cannot be added; quantity cannot exceed available stock.
- [ ] A server-rejected offline sale appears in the failed-sync queue with its reason; nothing is silently dropped.
- [ ] All existing sales/void/idempotency tests still green.

---

## 3. Phase B — Owner administration: staff & branch management 🔴

**Goal:** From Settings, an owner can run their whole business: create cashier accounts, assign them to branches, and manage branches — no Django admin needed.

### Backend
- [ ] **Staff API** (owner-only, scoped to users who have memberships in the owner's shops):
  - `GET /api/v1/staff` — list users with their memberships/roles across the owner's shops (search + pagination).
  - `POST /api/v1/staff` — create a user (`full_name`, `email`, `password`) **plus** initial memberships `[{shop_id, role}]` in one transaction. Validate every `shop_id` is owned by the caller.
  - `PATCH /api/v1/staff/{id}` — edit name/email, activate/deactivate (`is_active`), set new password (owner-initiated reset).
  - `POST /api/v1/staff/{id}/memberships` / `DELETE .../memberships/{mid}` — grant/revoke branch access + role.
  - Guards: an owner can never modify a user who has memberships in shops they don't own; owners cannot demote/deactivate **themselves**; every action writes an `ActivityLog` row.
- [ ] **Branch API**: extend `ShopViewSet` to full CRUD for owners — `POST /shops` (creates Shop + default `ShopSettings` + owner membership in one transaction), `PATCH /shops/{id}` (name/address/phone), `DELETE /shops/{id}` (soft-delete, blocked while the shop has completed sales unless archived-flag semantics; keep it simple: soft-delete = archive, hidden from switcher).
- [ ] **Data migration** seeding `owner`/`cashier` Role rows (fixes P11).
- [ ] Tests: staff CRUD permissions (cashier 403, other-owner 404), self-demotion blocked, membership validation, shop create/edit/archive, activity rows written.

### Frontend
- [ ] Rebuild `/settings` as a **tabbed settings area** (shadcn Tabs): **Business** · **Branches** · **Staff** · **Preferences** · **Appearance**.
  - **Business:** shop name, address, phone, logo URL, receipt footer — for the active branch.
  - **Branches:** table of the owner's branches; create/edit dialogs; archive with AlertDialog; new branch immediately appears in the shop switcher.
  - **Staff:** table (name, email, branches+roles, active status, last login); "Add staff" dialog (name/email/password + branch/role assignment); edit/deactivate/reset-password; RHF + zod validation on all forms.
  - **Preferences:** existing currency/tax/low-stock/timezone settings (language field hidden until i18n exists).
  - **Appearance:** existing dark-mode toggle.
- [ ] Cashiers never see the Settings nav item (already role-gated — keep it that way).

**DoD**
- [ ] An owner can, from the UI alone: create a branch, create a cashier, assign them to that branch, and the cashier can immediately log in and sell there.
- [ ] Deactivating a cashier blocks their next login/refresh.
- [ ] A cashier hitting any staff/branch endpoint gets 403/404; cross-owner access is impossible (tested).
- [ ] Fresh `migrate` (no seed) has `owner`/`cashier` roles present.

---

## 4. Phase C — Reports & analytics: charts + quick ranges 🟠

**Goal:** Reports and dashboards a shop owner is proud to show — visual, instant, and defaulting to "today".

### Backend
- [ ] Add **time-series data** to report payloads where missing: `sales_report` returns per-bucket series (already period-bucketed — verify shape includes date + totals per bucket suitable for charting); `profit_report` and `cashflow_report` gain equivalent series arrays; expenses by category totals for a donut.
- [ ] `GET /dashboard?date=YYYY-MM-DD` (default today) so the dashboard isn't hardcoded to now; include a 7-day mini-series for sparklines.
- [ ] Scope dashboard `cash_balance` to the selected period (or rename/label it "cash on hand — all time" explicitly; pick one and make the UI honest — fixes P9).
- [ ] Owner console compare endpoint returns per-shop series for the comparison chart.

### Frontend
- [ ] Add **Recharts** + a shared `src/components/charts/` module (theme-aware colors, currency-formatted tooltips via existing `formatMoney`, responsive containers, skeleton loaders).
- [ ] **Quick range picker** component used on Reports (and Activity): `Today · Yesterday · Last 7 days · This month · Last month · Custom`. Reports default to **Last 7 days**; the range is reflected in the export calls too.
- [ ] **Reports page:** Sales → line/area chart of revenue over the range + payment-method breakdown (stacked bar or donut) above the table; Profit → revenue vs. COGS vs. expenses grouped bars + net-profit line; Cash flow → in/out bars with running-balance line; Inventory → top-sellers horizontal bar + low/out-of-stock counts.
- [ ] **Dashboard:** add a 7-day sales sparkline to the sales KPI, a compact revenue-vs-expenses chart, and make "Best sellers" a horizontal bar chart.
- [ ] **Owner console:** shop-comparison grouped bar chart (sales/profit per shop) alongside the existing table.
- [ ] Replace hand-rolled tab buttons with shadcn Tabs while touching this page (part of P14).

**DoD**
- [ ] Every report tab renders at least one chart that matches its table's numbers for seeded data.
- [ ] One click on "Today" shows today's figures on any report; exports respect the selected range.
- [ ] Charts are legible in both light and dark themes; loading shows skeletons, empty ranges show a friendly empty state.

---

## 5. Phase D — Professional polish 🟡

**Goal:** Consistent, trustworthy UI on any device; no rough edges.

- [ ] **Mobile navigation** (P1): hamburger in the top bar opening a drawer (Radix Dialog/Sheet) with the same role-filtered nav; verify every page is usable at 375px; fix POS `h-[calc(100vh-7rem)]` clipping on short viewports.
- [ ] **AlertDialog everywhere** (P2): replace all `window.confirm` (product delete, expense delete, sale void, plus new branch-archive/staff-deactivate) with a shared shadcn AlertDialog wrapper.
- [ ] **Pagination** (P3): paginate Customers; add page-size select + "Page X of Y" to the shared pagination control used by all tables.
- [ ] **Error/empty separation** (P4): shared `QueryState` component — distinct error state with a Retry button (calls `refetch`) vs. true empty state; adopt on all list pages and the POS catalog.
- [ ] **Login page** (P6): demo credentials only rendered when `import.meta.env.DEV`.
- [ ] **Quick backend fixes:** apply `ShopSettings.low_stock_default` to new products when `min_stock_alert` is not provided (P7); `Payment.amount` min 1 (P10).
- [ ] **Type consolidation** (P12): migrate imports from hand-written `types/index.ts` to generated `types/api.ts` (or re-export generated types through it) so there is one source of truth.
- [ ] **Component consistency** (P14): shadcn Checkbox for the POS tax toggle; extract the duplicated role lookup into the existing `useActiveRole()` hook everywhere.
- [ ] **Toast coverage:** every mutation gets success/error toasts (audit customer + settings forms).

**DoD**
- [ ] Full app walk-through on a phone-sized viewport: navigate, sell, view reports, manage settings — no dead ends, no horizontal scroll.
- [ ] No `window.confirm` left in `src/`; no imports from the legacy type file (or it's a re-export shim).
- [ ] Every failed list query shows Retry and recovers when the server returns.

---

## 6. Phase E — Test & release hardening 🟢

- [ ] Backend: full test pass for Phases A–B behaviors (stock enforcement incl. concurrency, staff/branch RBAC matrix); report-series shape tests for Phase C.
- [ ] E2E (Playwright): out-of-stock item cannot be added/sold at the POS; owner creates branch + cashier via UI and the cashier logs in; Reports "Today" filter renders a chart; fix the `Charge $` → ETB currency assertion (P13).
- [ ] Regenerate OpenAPI schema + frontend types (`make types`); update `README`/`docs/api.md` for the new staff/branch endpoints.
- [ ] Fresh-stack smoke: `make up && make migrate && make seed` then the critical-path E2E suite green; prod compose boots with the new frontend build.

**DoD**
- [ ] CI green across backend, frontend unit, and E2E.
- [ ] A fresh prod deploy from the runbook exercises: create branch → create cashier → sell to zero stock → next sale blocked → today's report shows the sale on a chart.

---

## 7. Sequencing & rationale

**A → B → C → D → E.** Stock integrity first because it is a correctness/money bug (overselling corrupts inventory and profit numbers that every report depends on). Staff/branch management second because it unblocks real-world operation without developer intervention. Charts third — highest visible value once the numbers underneath are trustworthy. Polish fourth so it covers the new screens too. Hardening last, gating release.

Phases A and B are independent on the backend and could be built in parallel if desired; C depends on nothing but benefits from A (honest stock numbers). D touches everything, so it goes after the new surfaces exist.

## 8. Explicitly out of scope for v2 (unchanged from v1 §16)

Payroll, accounting integration, loyalty points, online ordering, SMS receipts, attendance, native mobile app, multi-device offline conflict resolution, i18n (the language setting stays hidden until a real i18n pass).
