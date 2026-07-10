# ShopM — Shop Management System

Multi-shop retail management with an offline-resilient POS and a remote owner console.
Built per [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), phase by phase.

> **Status:** Phases 0–8 ✅ (v1 complete) — Foundation · Catalog & inventory · POS / Sales · Purchases & expenses · Customers & credit · Reports & dashboard · Owner console · Notifications, settings & backup · Hardening & deployment

See the [deploy runbook](#production-deployment) below and the [backup & restore runbook](docs/BACKUP.md).

## Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.12, Django 5, DRF, SimpleJWT, Celery + Redis |
| Frontend | React 18 + Vite, TypeScript (strict), Tailwind + shadcn/ui, TanStack Query, Zustand |
| DB | PostgreSQL 16 |
| Infra (dev) | Docker Compose |
| Infra (prod) | Docker Compose + Nginx + gunicorn; Sentry (opt-in), structured logging |
| Tests | pytest (61 backend), Vitest, Playwright E2E (critical paths) |

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

The login screen leans into the product's identity — a monospace wordmark and a
receipt-strip motif (`✓ SYNCED`) that state the offline-POS promise at a glance.

## Testing

```bash
make test        # backend (pytest) + frontend (vitest) unit/integration
make test-e2e    # Playwright critical paths — needs the stack up + seeded first
make lint        # ruff + black --check + eslint + prettier --check
make audit       # dependency vulnerability audit (pip-audit + npm audit)
```

E2E covers the two critical paths from the plan: **login → POS sale → void → report**
and **offline sale → reconnect → sync**. If port 5173 is busy, run with `E2E_PORT=5199`.

## Production deployment

Prod runs an immutable multi-service stack (`docker-compose.prod.yml`): Postgres,
Redis, a gunicorn backend, Celery worker + beat, the built frontend, and an Nginx
edge that proxies `/api` and `/admin` to the backend and serves everything else
from the SPA.

```bash
# 1. Configure — copy the reference and fill real secrets (never commit .env.prod)
cp .env.prod.example .env.prod
#    Generate a secret key:
python -c "import secrets; print(secrets.token_urlsafe(50))"

# 2. Build & start
make deploy                       # docker compose -f docker-compose.prod.yml up -d --build
#    The backend entrypoint runs `migrate` + `collectstatic` automatically.

# 3. Seed the first owner (once), then rotate the demo password
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser

# 4. Verify
curl -fsS https://your-domain/healthz/     # {"status":"ok","db":true}
make deploy-logs                            # tail all services
```

**TLS** is terminated at the edge. Put `cert.pem`/`key.pem` in `nginx/certs/` and
enable the 443 block in `nginx/prod.conf`, or run behind a managed load balancer
(Django trusts `X-Forwarded-Proto`). **Backups** run nightly (Celery beat) to
`BACKUP_DIR` — see the [backup & restore runbook](docs/BACKUP.md); point that path
at persistent/object storage in prod.

### Security posture (plan §14)

- Passwords hashed (Django); **login is rate-limited** (`ScopedRateThrottle`, `THROTTLE_LOGIN`).
- Short-lived access tokens; refresh **rotation + blacklist**; **refresh revoked on logout**.
- **RBAC enforced server-side** on every endpoint/action; **tenancy isolation** returns 404 on cross-shop access.
- CORS restricted to known origins; prod sets HSTS, `nosniff`, `X-Frame-Options: DENY`, secure cookies, referrer policy.
- `shop_id`, totals, and status are server-controlled — never mass-assignable.
- Uploaded images are type/size-validated; **failed logins are logged and alert the owner** past a threshold.
- Error tracking via Sentry (enabled only when `SENTRY_DSN` is set); structured logs to stdout.
- Dependency audit is clean of production high/critical issues (`make audit`). The only
  remaining advisories are dev-only tools (`black`, `pytest`, Vite's `esbuild` dev
  server) whose fixes require major-version jumps we defer per the "no majors mid-build" rule.

## Common commands

Run `make help` for the full list (`up`, `migrate`, `seed`, `test`, `test-e2e`, `lint`, `fmt`, `types`, `audit`, `deploy`, `backup`, …).
