import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Minus,
  Receipt,
  ScanLine,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { TrendAreaChart } from "@/components/charts";
import { RankedBarList } from "@/components/ranked-bar-list";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveShop } from "@/features/pos/api";
import { useAuthStore } from "@/lib/auth";
import { formatEthiopianShort } from "@/lib/ethiopian";
import { formatMoney } from "@/lib/money";
import { cn, formatDateTime } from "@/lib/utils";

import { useDashboard } from "./api";

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore(
    (s) => s.memberships.find((m) => m.shop_id === s.activeShopId)?.role ?? null,
  );
  const isOwner = role === "owner";
  const shop = useActiveShop();
  const currency = shop?.currency ?? "ETB";
  const { data, isLoading } = useDashboard(isOwner);

  const firstName = user?.full_name.split(" ")[0] ?? "";

  if (!isOwner) {
    // Cashiers don't see financials (plan §8) — give them quick actions instead.
    return (
      <div>
        <PageHeader title={`Welcome, ${firstName}`} description="Quick actions for your shift." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <QuickLink to="/pos" icon={ScanLine} title="Point of Sale" desc="Ring up a sale" />
          <QuickLink
            to="/customers"
            icon={Users}
            title="Customers"
            desc="Manage customers & credit"
          />
        </div>
      </div>
    );
  }

  const t = data?.today;

  // Weekly synthesis, all derived from the 7-day sales series the API already
  // returns (index 6 = today, 5 = yesterday). Nothing here is invented — a stat
  // shows only when its underlying number exists.
  const series = data?.week_series ?? [];
  const todayTotal = series.length ? series[series.length - 1].total : 0;
  const yesterdayTotal = series.length > 1 ? series[series.length - 2].total : 0;
  const weekTotal = series.reduce((s, d) => s + d.total, 0);
  const avgPerDay = series.length ? Math.round(weekTotal / series.length) : 0;
  const bestDay = series.reduce<{ date: string; total: number }>(
    (best, d) => (d.total > best.total ? d : best),
    { date: "", total: 0 },
  );

  return (
    <div>
      <PageHeader title={`Welcome, ${firstName}`} description="Today at a glance." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Today's sales"
          icon={Receipt}
          value={t ? formatMoney(t.sales_total, currency) : undefined}
          sub={t ? `${t.sales_count} sale${t.sales_count === 1 ? "" : "s"}` : ""}
          loading={isLoading}
          delta={
            data ? (
              <DeltaBadge current={todayTotal} previous={yesterdayTotal} label="vs yesterday" />
            ) : undefined
          }
        />
        <Kpi
          label="Gross profit"
          icon={TrendingUp}
          value={t ? formatMoney(t.gross_profit, currency) : undefined}
          sub={t ? `Net ${formatMoney(t.net_profit, currency)}` : ""}
          loading={isLoading}
        />
        <Kpi
          label="Cash on hand"
          icon={Wallet}
          value={data ? formatMoney(data.cash_balance, currency) : undefined}
          sub="All time: cash received − expenses & purchases"
          loading={isLoading}
          negative={Boolean(data && data.cash_balance < 0)}
        />
        <Kpi
          label="Low-stock items"
          icon={Boxes}
          value={data ? String(data.low_stock_count) : undefined}
          sub={data ? `${data.total_products} products` : ""}
          loading={isLoading}
        />
      </div>

      {/* Weekly sales — the "today" tiles can read empty on a slow morning; this
          panel shows the week's shape and where today sits in it. */}
      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Sales · last 7 days
            </span>
            <div className="mt-2 flex items-center gap-2.5">
              {isLoading || !data ? (
                <Skeleton className="h-7 w-32" />
              ) : (
                <>
                  <span className="font-mono text-[26px] font-semibold leading-none tabular-nums">
                    {formatMoney(weekTotal, currency)}
                  </span>
                  <DeltaBadge
                    current={todayTotal}
                    previous={yesterdayTotal}
                    label="today vs yesterday"
                  />
                </>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <Skeleton className="h-[200px] w-full" />
          ) : (
            <TrendAreaChart
              data={series as unknown as Record<string, unknown>[]}
              dataKey="total"
              name="Sales"
              currency={currency}
              height={200}
            />
          )}
        </div>

        {!isLoading && data && (
          <div className="mt-4 grid grid-cols-3 gap-3 border-t pt-4">
            <MiniStat label="Today" value={formatMoney(todayTotal, currency)} />
            <MiniStat label="Avg / day" value={formatMoney(avgPerDay, currency)} />
            <MiniStat
              label="Best day"
              value={bestDay.total > 0 ? formatMoney(bestDay.total, currency) : "—"}
              hint={bestDay.total > 0 ? shortDay(bestDay.date) : undefined}
            />
          </div>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Best sellers (this month)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <RankedBarList
                items={(data?.best_sellers ?? []).map((b) => ({
                  name: b.name,
                  value: b.quantity,
                }))}
                formatValue={(v) => `${v} sold`}
                emptyText="No sales yet."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent sales</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : data && data.recent_sales.length > 0 ? (
              <ul className="space-y-1.5">
                {data.recent_sales.map((s) => (
                  <li key={s.id} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{formatDateTime(s.created_at)}</span>
                    <span className="font-mono tabular-nums">{formatMoney(s.total, currency)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No sales yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  label,
  icon: Icon,
  value,
  sub,
  loading,
  delta,
  negative = false,
}: {
  label: string;
  icon: typeof Receipt;
  value?: string;
  sub?: string;
  loading: boolean;
  delta?: ReactNode;
  negative?: boolean;
}) {
  return (
    <Card className="p-5">
      {/* Label set as an uppercase mono micro-label — the receipt's own
          vernacular (SUBTOTAL / CASH / CHANGE), so every tile reads like a line
          off the printer. */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {loading || value === undefined ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <div
          className={
            "mt-3 font-mono text-[26px] font-semibold leading-none tabular-nums" +
            (negative ? " text-destructive" : "")
          }
        >
          {value}
        </div>
      )}
      {(sub || delta) && (
        <div className="mt-2 flex items-center gap-2">
          {delta}
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      )}
    </Card>
  );
}

/** A trend chip in the PNL style: green up / red down / muted flat, with the
 *  period-over-period change. Shows only real comparisons — no baseline yet
 *  reads as "New", equal reads flat. */
function DeltaBadge({
  current,
  previous,
  label,
}: {
  current: number;
  previous: number;
  label?: string;
}) {
  let dir: "up" | "down" | "flat" = "flat";
  let text = "—";
  if (previous === 0) {
    if (current > 0) {
      dir = "up";
      text = "New";
    }
  } else {
    const pct = ((current - previous) / previous) * 100;
    dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
    const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
    text = `${pct > 0 ? "+" : ""}${rounded}%`;
  }
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  const tone =
    dir === "up"
      ? "bg-accent/10 text-accent"
      : dir === "down"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";
  return (
    <span
      title={label}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums",
        tone,
      )}
    >
      <Icon className="h-3 w-3" />
      {text}
    </span>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-[13px] font-semibold tabular-nums sm:text-sm">
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** "2026-07-13" → "Hamle 6" (Ethiopian short), for the best-day hint. */
function shortDay(iso: string): string {
  return formatEthiopianShort(iso);
}

function QuickLink({
  to,
  icon: Icon,
  title,
  desc,
}: {
  to: string;
  icon: typeof Receipt;
  title: string;
  desc: string;
}) {
  return (
    <Link to={to}>
      <Card className="transition-colors hover:border-accent">
        <CardContent className="flex items-center gap-3 p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="font-medium">{title}</p>
            <p className="text-sm text-muted-foreground">{desc}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
