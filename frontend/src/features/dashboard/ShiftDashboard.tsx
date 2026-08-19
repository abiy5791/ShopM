/**
 * The cashier's dashboard — their shift, not the shop's books.
 *
 * Everything here is either the person's own work (what they rang up today, how
 * their week is going) or a fact they need at the counter (what's running out,
 * who still owes money). Shop profit, valuation and cash position stay on the
 * owner's dashboard (plan §8).
 */

import {
  AlertTriangle,
  HandCoins,
  Package,
  Receipt,
  ScanLine,
  TrendingUp,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";

import { TrendAreaChart } from "@/components/charts";
import { DeltaBadge, Kpi } from "@/components/kpi";
import { PageHeader } from "@/components/page-header";
import { RankedBarList } from "@/components/ranked-bar-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import type { ShiftData } from "@/types";

export function ShiftDashboard({
  firstName,
  currency,
  data,
  isLoading,
}: {
  firstName: string;
  currency: string;
  data?: ShiftData;
  isLoading: boolean;
}) {
  const t = data?.today;
  const series = data?.week_series ?? [];
  const weekTotal = series.reduce((s, d) => s + d.total, 0);
  const weekCount = series.reduce((s, d) => s + d.count, 0);

  return (
    <div>
      <PageHeader
        title={`Welcome, ${firstName}`}
        description={
          data ? `${data.date_ethiopian} — your shift so far.` : "Your shift at a glance."
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi
          compact
          label="My sales today"
          icon={Receipt}
          value={t ? formatMoney(t.sales_total, currency) : undefined}
          sub={t ? `${t.sales_count} rung up` : ""}
          loading={isLoading}
          delta={
            t ? (
              <DeltaBadge
                current={t.sales_total}
                previous={t.yesterday_total}
                label="vs yesterday"
              />
            ) : undefined
          }
        />
        <Kpi
          compact
          label="Items sold"
          icon={Package}
          value={t ? String(t.items_sold) : undefined}
          sub="units across today's sales"
          loading={isLoading}
        />
        <Kpi
          compact
          label="Average sale"
          icon={TrendingUp}
          value={t ? formatMoney(t.avg_sale, currency) : undefined}
          sub="today"
          loading={isLoading}
        />
        <Kpi
          compact
          label="Running low"
          icon={AlertTriangle}
          value={data ? String(data.low_stock_count) : undefined}
          sub="products at or below their alert level"
          loading={isLoading}
          tone={data && data.low_stock_count > 0 ? "warning" : "default"}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <QuickLink to="/pos" icon={ScanLine} title="Point of Sale" desc="Ring up a sale" />
        <QuickLink to="/customers" icon={Users} title="Customers" desc="Look up credit balances" />
      </div>

      {/* The cashier's own week — answers "is today normal for me?" without
          showing anyone else's numbers. */}
      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              My sales · last 7 days
            </span>
            <div className="mt-2 flex items-center gap-2.5">
              {isLoading || !data ? (
                <Skeleton className="h-7 w-32" />
              ) : (
                <>
                  <span className="font-mono text-[26px] font-semibold leading-none tabular-nums">
                    {formatMoney(weekTotal, currency)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {weekCount} sale{weekCount === 1 ? "" : "s"}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="mt-4">
          {isLoading ? (
            <Skeleton className="h-[180px] w-full" />
          ) : (
            <TrendAreaChart
              data={series as unknown as Record<string, unknown>[]}
              dataKey="total"
              name="My sales"
              currency={currency}
              height={180}
            />
          )}
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My sales today</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : data && data.recent_sales.length > 0 ? (
              <ul className="space-y-2">
                {data.recent_sales.map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      {s.customer_name ?? "Walk-in"}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {formatDateTime(s.occurred_at)}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono tabular-nums">
                      {formatMoney(s.total, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No sales yet today. Head to the POS to ring one up.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What I sold most today</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <RankedBarList
                items={(data?.top_products ?? []).map((p) => ({
                  name: p.name,
                  value: p.quantity,
                }))}
                formatValue={(v) => `${v} sold`}
                emptyText="Nothing sold yet today."
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Running low</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : data && data.low_stock.length > 0 ? (
              <>
                <ul className="space-y-2">
                  {data.low_stock.map((p) => (
                    <li key={p.sku} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">
                        {p.name}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {p.sku}
                        </span>
                      </span>
                      <span
                        className={
                          "shrink-0 font-mono tabular-nums " +
                          (p.stock <= 0 ? "text-destructive" : "")
                        }
                      >
                        {p.stock <= 0 ? "out of stock" : `${p.stock} left`}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/products"
                  className="mt-3 inline-block text-xs text-accent underline-offset-2 hover:underline"
                >
                  See all products
                </Link>
              </>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Everything is above its alert level.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Checked before extending more credit at the till. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customers with a balance</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : data && data.top_debtors.length > 0 ? (
              <>
                <ul className="space-y-2">
                  {data.top_debtors.map((c) => (
                    <li key={c.name} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">{c.name}</span>
                      <span className="shrink-0 font-mono tabular-nums text-destructive">
                        {formatMoney(c.balance, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  {data.debtor_count} customer{data.debtor_count === 1 ? "" : "s"} owe money — check
                  before selling on credit.
                </p>
              </>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nobody owes money right now.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function QuickLink({
  to,
  icon: Icon,
  title,
  desc,
}: {
  to: string;
  icon: typeof HandCoins;
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
