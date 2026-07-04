# ShopM — Shop Management System

Multi-shop retail management with an offline-resilient POS and a remote owner console.
Built per [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), phase by phase.

> **Status:** Phases 0–6 ✅ — Foundation · Catalog & inventory · POS / Sales · Purchases & expenses · Customers & credit · Reports & dashboard · Owner multi-shop console

## Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.12, Django 5, DRF, SimpleJWT, Celery + Redis |
| Frontend | React 18 + Vite, TypeScript (strict), Tailwind + shadcn/ui, TanStack Query, Zustand |
| DB | PostgreSQL 16 |
| Infra | Docker Compose (dev) |

## Quick start

```bash
cp .env.example .env        # then edit secrets
make up                     # build & start db, redis, backend, worker, frontend
make migrate                # apply migrations
make seed                   # demo owner + 2 shops + cashiers + sample catalog
```

- Backend API: http://localhost:8000/api/v1/
- API docs (Swagger): http://localhost:8000/api/v1/docs/
- Frontend: http://localhost:5173/

### Demo credentials (from `make seed`)

| Role | Email | Password | Access |
|---|---|---|---|
| Owner | `owner@shopm.local` | `password123` | Both shops, all features |
| Cashier (Shop A) | `cashier.a@shopm.local` | `password123` | Shop A only, POS + customers |
| Cashier (Shop B) | `cashier.b@shopm.local` | `password123` | Shop B only, POS + customers |

## Architecture invariants (see plan §3 — do not violate)

1. **Multi-tenant from day one** — every business row carries `shop_id`; the active shop comes from the `X-Shop-Id` header and is validated against the user's memberships. Owner-wide endpoints live under `/api/v1/owner/`.
2. **Stock is a derived ledger** — `inventory_transactions` is append-only; `stock_cached` is a convenience kept in sync inside the same DB transaction.
3. **Balances are derived ledgers** too (customer credit, supplier payable).
4. **POS survives brief outages** — IndexedDB cart + outbox; sales carry a client UUID; server creation is idempotent.
5. **Money is integer minor units** — no floats, ever. Format only at the display edge.
6. **Soft-delete + audit** for destructive actions.

## Repo layout

```
backend/   Django + DRF (apps/: common, accounts, shops, activity, … per phase)
frontend/  React + Vite (src/: app, lib, features, components/ui, types)
docs/      plan, API reference, ADRs
```

## Design system

UI tokens are derived from the `ui-ux-pro-max` skill (style: *Data-Dense / Financial
Dashboard*; palette: *industrial slate + stock green*; type: Inter). See
[docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md). Tokens live in `frontend/src/index.css`.

## Common commands

Run `make help` for the full list (`up`, `migrate`, `seed`, `test`, `lint`, `fmt`, `types`, …).
