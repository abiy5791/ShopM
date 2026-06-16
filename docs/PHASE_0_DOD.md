# Phase 0 — Definition of Done (status)

Foundation & walking skeleton. All checks below were verified locally on
`config.settings.dev` (SQLite) and the pytest suite on `config.settings.test`.

| DoD item | Status | Evidence |
|---|---|---|
| `make up && make migrate && make seed` boots a working app from clean | ✅ | `migrate` applies all app + token_blacklist migrations; `seed` creates owner, 2 shops, a cashier each, settings. |
| Owner logs in, switches between 2 shops | ✅ | `/auth/login` → `/me` returns 2 memberships (role `owner`); shop switcher in UI. |
| Cashier logs in, sees only their shop with restricted nav | ✅ | Cashier `/me` returns 1 membership (role `cashier`); nav filtered by `visibleNav()`. |
| A request with a shop the user doesn't belong to returns 404 | ✅ | `GET /settings` with a foreign `X-Shop-Id` → **404** (ShopScopedViewSetMixin). |
| One write action produces an `activity_logs` row | ✅ | Login writes `auth.login`; settings update writes `settings.update` (tested). |
| CI green; OpenAPI schema generates; frontend type-checks in strict mode | ✅ | `.github/workflows/ci.yml`; `spectacular` → 0 errors; `tsc --noEmit` clean. |

## Verification commands

```bash
# Backend
cd backend
ruff check . && black --check .        # lint: clean
pytest                                  # 8 passed
DJANGO_SETTINGS_MODULE=config.settings.dev python manage.py migrate && python manage.py seed
python manage.py spectacular --file schema.yml   # 0 errors

# Frontend
cd frontend
npm run typecheck   # clean (strict)
npm run lint        # 0 errors
npm run test        # 3 passed
npm run build       # ok
npm run gen:types   # regenerates src/types/api.ts from backend schema
```

## Extra (RBAC / tenancy) proven at runtime

- Cashier `GET /settings` (own shop) → **403** (owner-only).
- Cashier `GET /activity` (own shop) → **200** (members can read; cashier sees own rows).
- Missing `X-Shop-Id` on a shop-scoped endpoint → **400** `{code: "shop_required"}`.

## Notes carried into later phases

- `stock_cached` / `credit_balance_cached` and the inventory ledger arrive in Phase 1.
- Real dashboard metrics (Phase 5), POS (Phase 2), reports (Phase 5) are placeholder
  routes today, gated by role so the nav already reflects the final permission model.
- Generated API types (`src/types/api.ts`) exist; as resources land, components should
  migrate from the hand-written `src/types/index.ts` to `components["schemas"]`.
