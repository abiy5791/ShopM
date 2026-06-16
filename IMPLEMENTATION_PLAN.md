# Shop Management System — Implementation Plan

> **Audience:** Claude Code (and human reviewers).
> **Purpose:** A self-contained, sequenced plan to build a production-ready, multi-shop retail management system. Execute phase by phase. Do not skip ahead — each phase has a **Definition of Done (DoD)** that gates the next.

---

## 0. How to use this document

- Build in the **phase order** below (Phase 0 → Phase 8). Each phase is independently shippable and testable.
- Every phase ends with a **DoD checklist**. Do not begin the next phase until all boxes are checked and tests pass.
- **Locked decisions** in §3 are not up for debate during the build. If you believe one is wrong, stop and flag it in a comment/PR — do not silently change it.
- Prefer **small, reviewable commits**, one logical change each. Conventional Commits style (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
- When a task is ambiguous, follow the **conventions** in §12 and the **DoD** as the source of truth, rather than inventing scope.
- Write tests **as you go**, not at the end (see §13).

---

## 1. Project overview

A web-based management system for small local retail shops, plus a **remote owner console** for monitoring and comparing multiple shops. Two primary user types:

- **Owner** — sees and manages all their shops, all reports, users, and settings.
- **Cashier** — operates a single shop: POS, customers, view products. No financial reports, no settings.

The system must remain **lightweight and fast for daily shop use** while supporting **multi-shop remote oversight**.

### Success criteria (the system is "done enough to run a shop" when)
1. A cashier can ring up a sale, take payment, and print a receipt in under 10 seconds — **even if the internet briefly drops**.
2. Stock levels are always correct and traceable to individual movements.
3. An owner can open one dashboard and see live numbers across every shop.
4. Money in / money out (sales, purchases, expenses, credit) reconciles exactly.

---

## 2. Goals & non-goals

**Goals (v1):** Dashboard, Products, Inventory, POS/Sales, Customers + credit, Suppliers, Purchases, Expenses, Reports, Users/RBAC, Notifications, Activity Log, Settings, Owner multi-shop console.

**Non-goals (v1):** Payroll, accounting integration, loyalty points, online ordering, QR products, SMS receipts, employee attendance, native mobile app. These are **§16 Future Work** — do not build them now.

---

## 3. Locked architectural decisions

These are decided. Build to them.

### 3.1 Multi-tenant from day one
Every business row (product, sale, expense, etc.) carries a `shop_id` FK and **all queries are scoped by the active shop**. Rationale: retrofitting tenancy later means rewriting every query and migrating live data; doing it now is nearly free.

- A `Shop` is the tenant boundary.
- A `User` accesses one or more shops via `ShopMembership` (user + shop + role).
- The active shop is selected per-request via the `X-Shop-Id` header, validated against the user's memberships. Owner-wide endpoints live under `/api/v1/owner/` and ignore the header.

### 3.2 Stock is derived from an immutable ledger
There is **no editable `current_stock` column as a source of truth**. Stock for a product = the signed sum of its `InventoryTransaction` rows. Rationale: a single mutable balance silently drifts; an append-only ledger is auditable and self-healing.

- Every stock change (purchase, sale, adjustment, damage, return, expiry) inserts an `InventoryTransaction` row. Rows are **never updated or deleted**; corrections are new compensating rows.
- For read performance, products **may** carry a cached `stock_cached` integer, updated in the same DB transaction as the ledger insert, with a nightly reconciliation job that recomputes from the ledger and logs any mismatch. The ledger remains authoritative.

### 3.3 Account balances are derived ledgers too
Customer credit balance and supplier payable balance are **computed from transaction rows** (sales on credit, customer payments, purchases on credit, supplier payments), not stored as a single mutable number. Same caching rule as 3.2 may apply for display.

### 3.4 POS is resilient to brief connectivity loss
The POS page must continue to take sales when the network drops, then sync when it returns. Rationale: mobile-money markets often have patchy internet; a POS that stops on a dropped connection stops the shop's income — a worse failure than any missing report.

- The cart and an outbox of completed-but-unsynced sales live in **IndexedDB** on the client.
- Each sale is created with a **client-generated UUID** (idempotency key) so a retry never double-records.
- The server treats sale creation as **idempotent on that UUID**.
- Full multi-device offline sync (conflict resolution across devices) is **out of scope for v1**; v1 only needs single-device queue-and-replay.

### 3.5 Money is integer minor units
All monetary values are stored as **integers in the currency's minor unit** (e.g. cents). No floats for money, anywhere. Currency is per-shop in settings. Format only at the display edge.

### 3.6 Soft-delete + audit for destructive actions
"Deleting" a product, sale, or expense sets `deleted_at` / `voided_at` and writes an `ActivityLog` row. Hard deletes are reserved for data with no financial trail. Voiding a completed sale reverses its ledger effects via compensating rows (never by mutating originals).

---

## 4. Tech stack (locked)

| Layer | Choice |
|---|---|
| Backend | Python 3.12, Django 5.x, Django REST Framework |
| Auth | JWT (access + refresh) via `djangorestframework-simplejwt`, RBAC |
| DB | PostgreSQL 16 |
| Background jobs | Celery + Redis (reconciliation, summaries, notifications) |
| Frontend | React 18 + Vite, TypeScript (strict) |
| Styling | Tailwind CSS + shadcn/ui |
| Server state | TanStack Query |
| Client state | Zustand |
| Offline store | IndexedDB via `idb` |
| Forms/validation | React Hook Form + Zod |
| API types | Generated from OpenAPI (DRF `drf-spectacular` → `openapi-typescript`) |
| Containerization | Docker + docker-compose (dev), Docker + Nginx (prod) |
| Object storage | Local FS (dev), S3-compatible (prod) for receipt/expense images |
| Tests | Backend: pytest + pytest-django; Frontend: Vitest + Testing Library; E2E: Playwright |
| Lint/format | Backend: ruff + black; Frontend: ESLint + Prettier |

Pin exact versions in lockfiles. Do not upgrade majors mid-build.

---

## 5. Repository structure (monorepo)

```
shop-system/
├── docker-compose.yml            # dev: db, redis, backend, frontend, worker
├── .env.example                  # documented; never commit real .env
├── Makefile                      # common commands (see §6)
├── README.md
├── docs/
│   ├── IMPLEMENTATION_PLAN.md    # this file
│   ├── api.md                    # generated/maintained API reference
│   └── decisions/                # ADRs for any deviation from §3
├── backend/
│   ├── pyproject.toml
│   ├── manage.py
│   ├── config/                   # settings (base/dev/prod), urls, celery, asgi/wsgi
│   └── apps/
│       ├── accounts/             # users, roles, memberships, JWT, RBAC
│       ├── shops/                # shops, settings, tenancy middleware
│       ├── catalog/              # categories, products, suppliers
│       ├── inventory/            # inventory_transactions (the ledger)
│       ├── sales/                # sales, sale_items, payments, POS endpoints
│       ├── purchases/            # purchases, purchase_items
│       ├── customers/            # customers, credit ledger
│       ├── expenses/             # expenses, expense categories
│       ├── reports/              # aggregation + export endpoints
│       ├── owner/                # cross-shop console endpoints
│       ├── notifications/        # alerts
│       ├── activity/             # activity_logs (cross-cutting)
│       └── common/               # base models, mixins, pagination, money type
└── frontend/
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── app/                  # routing, providers, layout
        ├── lib/                  # api client, query client, auth, money, offline (idb)
        ├── features/             # one folder per domain (pos, products, reports, ...)
        ├── components/ui/        # shadcn primitives
        └── types/                # generated API types
```

---

## 6. Environment & tooling (Phase 0 deliverables)

`make` targets to implement:

```
make up           # docker-compose up (db, redis, backend, frontend, worker)
make migrate      # backend migrations
make seed         # demo data: 1 owner, 2 shops, 1 cashier each, sample catalog
make test         # backend + frontend unit tests
make test-e2e     # Playwright
make lint         # ruff + black --check + eslint + prettier --check
make fmt          # auto-format both sides
make types        # regenerate OpenAPI + frontend types
```

`.env.example` must document every variable (DB, Redis, JWT secrets/lifetimes, S3, CORS origins, default currency).

---

## 7. Data model

Conventions: every table has `id` (UUID pk), `created_at`, `updated_at`. Tenant tables also have `shop_id` FK and (where relevant) `deleted_at`. Money columns are `BIGINT` minor units. Index every FK and every field used in list filters.

### Core / accounts
- **roles** — `name` (`owner` | `cashier`), `permissions` (JSON or coded).
- **users** — `email` (unique), `password`, `full_name`, `is_active`, `last_login_ip`.
- **shops** — `name`, `address`, `phone`, `owner_id` → users.
- **shop_memberships** — `user_id`, `shop_id`, `role_id`. Unique (`user_id`,`shop_id`).
- **settings** — one row per shop: `currency`, `tax_rate`, `logo_url`, `receipt_footer`, `low_stock_default`, `language`, `timezone`.

### Catalog
- **categories** — `shop_id`, `name`. Unique (`shop_id`,`name`).
- **products** — `shop_id`, `name`, `sku` (unique per shop), `barcode`, `category_id`, `purchase_price`, `selling_price`, `unit` (pcs/kg/l/…), `min_stock_alert`, `supplier_id` (nullable), `status` (active/inactive), `stock_cached`, `deleted_at`.
- **suppliers** — `shop_id`, `name`, `phone`, `address`, `notes`.

### Inventory (the ledger)
- **inventory_transactions** — `shop_id`, `product_id`, `quantity` (**signed**: + in, − out), `type` (`purchase`|`sale`|`adjustment`|`damage`|`expiry`|`return_in`|`return_out`|`reconcile`), `unit_cost` (nullable), `reference_type` + `reference_id` (links to sale/purchase), `user_id`, `notes`, `created_at`. **Append-only.**

### Sales / POS
- **sales** — `shop_id`, `client_uuid` (unique — idempotency key from §3.4), `cashier_id`, `customer_id` (nullable), `subtotal`, `discount`, `tax`, `total`, `status` (`completed`|`voided`), `voided_at`, `voided_by`.
- **sale_items** — `sale_id`, `product_id`, `name_snapshot`, `unit_price_snapshot`, `quantity`, `line_total`. (Snapshot prices so historic receipts never change when a product's price changes.)
- **payments** — `shop_id`, `sale_id` (nullable), `customer_id` (nullable, for standalone credit settlement), `method` (`cash`|`bank`|`mobile_money`), `amount`, `received_at`, `user_id`.

### Purchases
- **purchases** — `shop_id`, `supplier_id`, `total`, `payment_status` (`paid`|`partial`|`unpaid`), `date`, `user_id`.
- **purchase_items** — `purchase_id`, `product_id`, `quantity`, `unit_cost`, `line_total`. On purchase creation, insert `inventory_transactions` (`type=purchase`, +qty) and recompute `stock_cached` in the **same DB transaction**.

### Customers & credit
- **customers** — `shop_id`, `name`, `phone`, `address`, `notes`, `credit_balance_cached`. Balance derived from credit sales minus customer payments.

### Expenses
- **expense_categories** — `shop_id`, `name` (seed: Rent, Salary, Electricity, Internet, Transport, Maintenance, Misc).
- **expenses** — `shop_id`, `category_id`, `amount`, `date`, `description`, `receipt_image_url` (nullable), `user_id`.

### Cross-cutting
- **notifications** — `shop_id`, `type`, `payload` (JSON), `level` (info/warn/critical), `read_at`, `created_at`.
- **activity_logs** — `shop_id` (nullable for system-level), `user_id`, `action`, `entity_type`, `entity_id`, `metadata` (JSON), `ip`, `created_at`. **Append-only.**

> Write Django migrations incrementally per phase, not one giant migration.

---

## 8. Multi-tenancy & RBAC

- **Tenancy middleware/permission:** resolve active shop from `X-Shop-Id`; reject if the authenticated user has no membership in that shop (404, not 403 — don't reveal existence). Provide a `ShopScopedQuerysetMixin` so viewsets auto-filter by active shop. **No viewset may return cross-shop rows except under `/api/v1/owner/`.**
- **Roles:**
  - `owner`: full CRUD on their shops; all reports; user/membership management; owner console; settings.
  - `cashier`: POS (create sales, take payments), customers (CRUD), products (read-only), own activity. **Denied:** financial reports, expenses, purchases, settings, user management, sale voiding (configurable).
- Enforce permissions at the **DRF permission class** level (per viewset + per action), not just in the UI. The frontend hides what the user can't do; the backend is the real gate.

---

## 9. API conventions

- Base path `/api/v1/`. JSON only. Auth via `Authorization: Bearer <access>`.
- Standard list params: `?search=&ordering=&page=&page_size=` plus resource filters.
- Errors: consistent envelope `{ "detail": "...", "code": "...", "fields": {...} }`.
- Idempotency: `POST /sales` keyed on `client_uuid`; replays return the original sale with `200`, not a duplicate.
- OpenAPI schema auto-generated (`drf-spectacular`); frontend types generated from it (`make types`). **Never hand-write API types on the frontend.**

### Endpoint map (high level)
```
POST   /api/v1/auth/login            /auth/refresh   /auth/logout
GET    /api/v1/me                     # profile + memberships + active-shop role

# shop-scoped (require X-Shop-Id)
CRUD   /api/v1/products  /categories  /suppliers  /customers
GET    /api/v1/products/{id}/stock    # derived from ledger
POST   /api/v1/inventory/adjust       # manual adjustment → ledger row
GET    /api/v1/inventory/transactions
POST   /api/v1/sales                  # idempotent; POS checkout
POST   /api/v1/sales/{id}/void
GET    /api/v1/sales  /sales/{id}/receipt
CRUD   /api/v1/purchases  /expenses
POST   /api/v1/payments               # against sale or customer credit
GET    /api/v1/dashboard              # today's summary
GET    /api/v1/reports/{daily|weekly|monthly|yearly|inventory|profit|cashflow}
GET    /api/v1/reports/.../export?format=pdf|xlsx
CRUD   /api/v1/notifications  (mark read)
GET    /api/v1/activity
CRUD   /api/v1/settings
CRUD   /api/v1/users  /memberships    # owner only

# owner-wide (no X-Shop-Id; aggregates across owner's shops)
GET    /api/v1/owner/dashboard
GET    /api/v1/owner/shops/compare
GET    /api/v1/owner/activity
```

---

## 10. Offline POS strategy (detail for Phase 2)

1. On POS load, **prefetch** the active shop's active products into IndexedDB (id, name, sku, barcode, selling_price, unit, stock_cached). Refresh on a timer and on reconnect.
2. Cart lives in Zustand + mirrored to IndexedDB so a refresh/crash doesn't lose it.
3. On checkout: generate `client_uuid`, build the sale, attempt `POST /sales`.
   - **Online:** server records, returns sale; print receipt from server response.
   - **Offline:** store the sale in an IndexedDB **outbox**, mark "pending sync", print receipt locally (receipt does not require server). UI shows a "pending sync" badge with count.
4. A background sync loop replays the outbox when online, in order, using each sale's `client_uuid`. Server idempotency guarantees no duplicates. On success, remove from outbox.
5. Stock shown offline is best-effort from `stock_cached`; the server remains authoritative and reconciles on sync. Surface a clear note that offline stock may be slightly stale.

**v1 boundary:** single-device queue-and-replay only. Cross-device conflict resolution and offline-created products are future work.

---

## 11. Phased delivery plan

### Phase 0 — Foundation & walking skeleton
**Goal:** A deployable empty app where an owner can log in, pick a shop, and a cashier sees a locked-down shell. Tenancy, RBAC, activity logging, and CI all working end to end on a trivial resource.

**Tasks**
- Repo scaffold per §5; docker-compose (db, redis, backend, frontend, worker); Makefile; `.env.example`.
- Django project + apps skeleton; `common` base model (UUID pk, timestamps, money field, soft-delete mixin).
- Models + migrations: roles, users, shops, shop_memberships, settings, activity_logs.
- JWT auth (login/refresh/logout); `/me`; RBAC permission classes; tenancy middleware + `X-Shop-Id` resolution; `ShopScopedQuerysetMixin`.
- Activity-log writer (signal/util) used by at least one action.
- `drf-spectacular` schema; `make types`.
- React shell: providers (Query, auth, router), login page, shop switcher, role-aware nav, protected routes, generated API types wired in.
- `make seed`: 1 owner, 2 shops, a cashier per shop, a couple of categories/products.
- CI: lint + tests on every push.

**DoD**
- [ ] `make up && make migrate && make seed` boots a working app from clean.
- [ ] Owner logs in, switches between 2 shops; cashier logs in and sees only their shop with restricted nav.
- [ ] A request with a shop the user doesn't belong to returns 404.
- [ ] One write action produces an `activity_logs` row.
- [ ] CI green; OpenAPI schema generates; frontend type-checks in strict mode.

---

### Phase 1 — Catalog & inventory ledger
**Goal:** Manage products/categories/suppliers; stock is correct and derived from the ledger.

**Tasks**
- CRUD: categories, suppliers, products (with search, barcode, status, soft-delete).
- `inventory_transactions` model + append-only enforcement.
- Manual stock adjustment endpoint → ledger row + `stock_cached` update in one DB transaction.
- `GET /products/{id}/stock` and transaction history with filters.
- Nightly Celery reconciliation: recompute `stock_cached` from ledger, log mismatches.
- Excel import/export for products (xlsx skill conventions).
- Frontend: product list (search, low-stock highlight), product form, stock-adjust dialog, transaction history view.

**DoD**
- [ ] Creating an adjustment changes derived stock and writes exactly one ledger row.
- [ ] `stock_cached` always equals `SUM(quantity)` from the ledger (test with concurrent writes).
- [ ] Reconciliation job runs and reports zero mismatches on seeded data.
- [ ] Import/export round-trips without data loss.
- [ ] Cashier can view products but cannot edit them (backend-enforced).

---

### Phase 2 — POS / Sales (the core)
**Goal:** Fast checkout with payments and a printable receipt, resilient to brief outages.

**Tasks**
- Models: sales, sale_items (with price snapshots), payments.
- `POST /sales` idempotent on `client_uuid`, in a DB transaction: create sale + items + payment(s) + inventory_transactions (type=sale, −qty) + `stock_cached` update.
- `POST /sales/{id}/void`: compensating ledger rows + status update + activity log (permission-gated).
- Receipt endpoint/render (shop name, date, cashier, items, totals, payment, change).
- Offline layer per §10 (IndexedDB prefetch, cart mirror, outbox, sync loop, idempotent replay).
- POS UI: product search + barcode input, cart, qty edit, discount, optional tax, payment method(s) incl. split, change calc, print, pending-sync badge.

**DoD**
- [ ] A sale decrements stock by exactly the sold quantity (ledger-verified).
- [ ] Replaying the same `client_uuid` never creates a duplicate sale.
- [ ] With the network disabled, a cashier completes a sale and prints a receipt; on reconnect it syncs once.
- [ ] Voiding a sale fully reverses its stock effect and is logged.
- [ ] Changing a product's price afterward does not alter past receipts.
- [ ] Checkout (add → pay → print) completes in <10s in a manual run.

---

### Phase 3 — Purchases & expenses
**Goal:** Record stock purchases (auto stock-in) and shop expenses.

**Tasks**
- Models: purchases, purchase_items, expense_categories (seeded), expenses.
- Purchase creation: items + inventory_transactions (type=purchase, +qty) + `stock_cached`, all in one transaction; set `payment_status`.
- Expense CRUD with optional receipt image upload (local dev / S3 prod).
- Frontend: purchase entry, purchase history, expense entry + list, image upload.

**DoD**
- [ ] Recording a purchase increases stock by the purchased quantity (ledger-verified).
- [ ] Expense image uploads work in dev (local) and are S3-ready (config-switchable).
- [ ] Cashier cannot access purchases or expenses (backend-enforced).

---

### Phase 4 — Customers & credit
**Goal:** Regular customers, credit sales, and settlements that reconcile.

**Tasks**
- Customer CRUD; link sales to customers; credit-sale flow (sale total > paid → balance).
- `POST /payments` against a customer to settle credit; balance derived from credit sales − customer payments (`credit_balance_cached` updated transactionally).
- Customer detail: purchase history, outstanding balance, payment history.

**DoD**
- [ ] A credit sale increases the customer's derived balance by exactly the unpaid amount.
- [ ] A settlement payment reduces it correctly; `credit_balance_cached` always matches the derived value (tested).
- [ ] Supplier payable mirrors the same pattern for partial/unpaid purchases.

---

### Phase 5 — Reports & dashboard
**Goal:** Per-shop dashboard and exportable reports.

**Tasks**
- `GET /dashboard`: today's sales, expenses, profit, low-stock count, total products, recent transactions, best sellers, cash balance.
- Reports: daily/weekly/monthly/yearly; inventory (low/out/valuation/top sellers); profit; cash flow. All shop-scoped, date-ranged.
- Export to PDF (pdf skill) and Excel (xlsx skill).
- Frontend: dashboard cards/widgets, report pages with date pickers and export buttons.

**DoD**
- [ ] Dashboard numbers tie out to underlying ledgers (sales/expenses/inventory) for seeded data — verified by a reconciliation test.
- [ ] Each report exports valid PDF and XLSX.
- [ ] Cashier cannot reach financial reports (backend-enforced).

---

### Phase 6 — Owner multi-shop console
**Goal:** One remote view across all of an owner's shops.

**Tasks**
- `/api/v1/owner/dashboard`: live sales, cash balance, daily profit, low-stock alerts, top sellers, staff-entered expenses, stock movements — aggregated across shops.
- `/api/v1/owner/shops/compare`: side-by-side performance.
- `/api/v1/owner/activity`: employee activity across shops.
- Optional Celery task: daily email/WhatsApp summary (behind a feature flag; email first, WhatsApp stubbed).
- Frontend: owner console with per-shop breakdown and comparison view.

**DoD**
- [ ] Owner sees correct aggregates spanning ≥2 shops; a cashier hitting any `/owner/` route gets 403.
- [ ] Comparison view ranks shops by sales/profit for a chosen period.
- [ ] Daily summary task runs on schedule and emails the owner (in dev: mailhog/console backend).

---

### Phase 7 — Notifications, activity log UI, settings, backup
**Goal:** Operational polish.

**Tasks**
- Notification generation: low stock, out of stock, large expense, large refund/void, daily sales summary, failed login attempts. Persist + surface in UI; mark-read.
- Activity log viewer (filter by user/action/date).
- Settings UI: shop info, logo, receipt footer, currency, tax rate, language, dark mode, low-stock default.
- Backup/restore: scheduled `pg_dump` to storage; documented restore procedure; admin-triggered manual backup.

**DoD**
- [ ] Each notification trigger fires on the right condition and is dismissible.
- [ ] Failed logins are logged and (after a threshold) notify the owner.
- [ ] Settings changes take effect (currency/tax/receipt) and are logged.
- [ ] A backup can be produced and successfully restored into a clean DB (documented + tested once).

---

### Phase 8 — Hardening & deployment
**Goal:** Production-ready.

**Tasks**
- Security pass (§14): rate-limit auth, rotate/secure JWT secrets, refresh-token revocation on logout, CORS lockdown, security headers, input validation review, dependency audit.
- Performance: index review on hot list/report queries; pagination everywhere; N+1 check (`select_related`/`prefetch_related`).
- Prod compose: Nginx in front of backend + static frontend; Postgres with automated backups; Redis; HTTPS; gunicorn/uvicorn workers.
- Observability: structured logging, error tracking (e.g. Sentry), `/healthz`.
- E2E suite (Playwright) covering the critical paths: login → POS sale → void → report; offline sale → reconnect → sync.
- `README` deploy runbook + `.env` reference + restore drill.

**DoD**
- [ ] All critical-path E2E tests pass.
- [ ] No high/critical issues in dependency audit.
- [ ] A fresh prod deploy from the runbook serves the app over HTTPS with automated DB backups confirmed.
- [ ] Load smoke test: dashboard + product list + checkout stay responsive with seeded volume (e.g. 5k products, 50k sales).

---

## 12. Coding conventions

**Backend**
- Thin views, fat services: business logic (sales checkout, void, purchase stock-in) lives in `services.py` per app, wrapped in `transaction.atomic()`. Viewsets orchestrate, don't compute.
- Never trust client-supplied totals — recompute server-side from items × snapshot prices.
- All money via the `common` money helpers; never raw floats.
- One concern per migration; no destructive data migrations without a backup step.
- ruff + black; type hints on service functions.

**Frontend**
- TypeScript strict; no `any`. Use generated API types only.
- TanStack Query for all server state; Zustand only for genuinely client-side state (cart, UI, offline outbox).
- React Hook Form + Zod on every form; validate before submit.
- Feature-folder structure; shared primitives in `components/ui`.
- No business math on the client beyond display (server is the source of truth); offline cart math must mirror the server's formula exactly and is covered by a shared test vector.

**Both**
- Conventional Commits; small PRs; every PR updates/added tests; no merge on red CI.

---

## 13. Testing strategy

- **Backend unit/integration (pytest):** every service function; idempotent sale creation; void reversal; ledger-derived stock and balances under concurrency; permission classes per role; tenancy isolation (user A cannot read shop B).
- **Frontend unit (Vitest + Testing Library):** cart logic, offline outbox state machine, money formatting, form validation.
- **E2E (Playwright):** the critical paths in Phase 8 DoD, including the offline → reconnect → sync path.
- **Reconciliation tests:** assert `stock_cached`/`credit_balance_cached` equal their derived values after a randomized sequence of operations.
- Minimum: no phase is "done" without tests for its DoD assertions.

---

## 14. Security checklist (apply throughout, verify in Phase 8)

- [ ] Passwords hashed (Django default); auth endpoints rate-limited.
- [ ] Short-lived access tokens; refresh rotation; refresh revoked on logout.
- [ ] RBAC enforced server-side on every endpoint and action.
- [ ] Tenancy isolation enforced server-side (404 on cross-shop access).
- [ ] CORS restricted to known origins; security headers (HSTS, X-Content-Type-Options, etc.).
- [ ] All input validated/serialized; no mass-assignment of server-controlled fields (`shop_id`, totals, status).
- [ ] Uploaded images validated (type/size) and served from non-executable storage.
- [ ] Failed-login logging + alerting.
- [ ] Secrets via env, never committed; `.env.example` documents them.
- [ ] Dependency audit clean.

---

## 15. Definition of "production-ready" (project-level)

All phase DoDs met **and**: automated DB backups verified by a restore drill; HTTPS; error tracking live; critical-path E2E green; deploy runbook reproducible from scratch; tenancy + RBAC isolation proven by tests.

---

## 16. Future work (do NOT build in v1)

Multi-branch beyond owner console, barcode label printing, QR products, loyalty points, SMS receipts, online ordering, employee attendance, payroll, accounting integration, native owner mobile app, **full multi-device offline sync with conflict resolution**.

---

## 17. Glossary

- **Ledger** — append-only table that is the source of truth (inventory_transactions; credit via sales/payments).
- **Tenant** — a Shop; the isolation boundary for all business data.
- **Idempotency key** — `client_uuid` on a sale ensuring replays don't duplicate.
- **Cached balance** — a denormalized convenience value (`stock_cached`, `credit_balance_cached`) kept in sync with, and always reconcilable to, the ledger.
- **DoD** — Definition of Done; the gate that must pass before the next phase.
