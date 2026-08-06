import { Boxes, Receipt, TrendingUp, Wallet } from "lucide-react";

import { TrendAreaChart } from "@/components/charts";
import { DeltaBadge, Kpi } from "@/components/kpi";
import { RankedBarList } from "@/components/ranked-bar-list";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveShop } from "@/features/pos/api";
import { useAuthStore } from "@/lib/auth";
import { formatEthiopianShort } from "@/lib/ethiopian";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";

import { useDashboard, useShift } from "./api";
import { ShiftDashboard } from "./ShiftDashboard";

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore(
    (s) => s.memberships.find((m) => m.shop_id === s.activeShopId)?.role ?? null,
  );
  const isOwner = role === "owner";
  const shop = useActiveShop();
  const currency = shop?.currency ?? "ETB";
  const { data, isLoading } = useDashboard(isOwner);
  const shift = useShift(!isOwner);

  const firstName = user?.full_name.split(" ")[0] ?? "";

  if (!isOwner) {
    // Cashiers get their own shift instead of the shop's books (plan §8).
    return (
      <ShiftDashboard
        firstName={firstName}
        currency={currency}
        data={shift.data}
        isLoading={shift.isLoading}
      />
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
          tone={data && data.cash_balance < 0 ? "negative" : "default"}
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
