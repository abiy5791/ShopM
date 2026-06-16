# ShopM Design System

> Derived from the **ui-ux-pro-max** skill (style + palette + typography + UX rules),
> then adapted for a retail/finance admin tool. Tokens are implemented as CSS variables
> in `frontend/src/index.css` and wired into Tailwind + shadcn/ui.

## Style

**Data-Dense Dashboard** with **Financial Dashboard** semantics — chosen because ShopM is
a POS + reporting + multi-shop console, not a marketing site.

- 12-column grid, compact padding (8–12px), table row height ~36px
- Sidebar 240px, header 56px
- KPI cards row, sortable dense tables with sticky headers
- Number count-up on dashboards; profit/loss colour transitions

## Palette — "Industrial slate + stock green"

| Token | Light | Use |
|---|---|---|
| `--primary` | `#334155` slate-700 | primary actions, nav active |
| `--secondary` | `#475569` slate-600 | secondary surfaces |
| `--accent` | `#059669` emerald-600 | stock / money highlights |
| `--background` | `#F8FAFC` | app background |
| `--foreground` | `#0F172A` | primary text |
| `--card` | `#FFFFFF` | cards, tables |
| `--muted` | `#F2F3F4` | muted surfaces |
| `--muted-foreground` | `#64748B` | secondary text |
| `--border` | `#E6E8EA` | borders, dividers |
| `--destructive` | `#DC2626` | delete / void |
| `--ring` | `#334155` | focus ring |

**Financial semantics:** profit/positive `#22C55E`, loss/negative `#EF4444`.
A dark theme mirrors these (slate-950 base) — toggled in Settings (Phase 7).

## Typography

- **UI:** Inter (*Minimal Swiss* pairing) — clean, professional, enterprise admin.
- **Numeric/SKU/money:** a monospace stack (`ui-monospace`, `JetBrains Mono`) so columns
  of figures align — important for POS and reports.

## UX rules (enforced as we build)

- Forms: React Hook Form + Zod, **validate on blur**, loading → success/error feedback,
  errors announced via `role="alert"` / `aria-live`.
- Tables: helpful **empty states** (message + action), loading skeletons, sortable,
  horizontal scroll / card fallback on mobile.
- Icons: **Lucide SVG only — never emoji**.
- All clickable elements get `cursor-pointer`; hover transitions 150–300ms.
- Contrast ≥ 4.5:1; **visible focus** rings for keyboard nav; honour `prefers-reduced-motion`.
- Responsive breakpoints: 375 / 768 / 1024 / 1440.
