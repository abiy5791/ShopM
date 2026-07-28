import {
  ChevronLeft,
  ChevronRight,
  Coffee,
  Coins,
  Printer,
  Receipt,
  RefreshCw,
  ScrollText,
  ShoppingBag,
  TrendingUp,
  Trophy,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { ChartCard, DonutChart } from "@/components/charts";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EthiopianDatePicker } from "@/components/ethiopian-date-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveShop } from "@/features/pos/api";
import { formatEthiopian } from "@/lib/ethiopian";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

import { useDayBook } from "./api";

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  telebirr: "Telebirr",
  cbe: "CBE",
  abyssinia: "Bank of Abyssinia",
  bank: "Bank",
  mobile_money: "Mobile money",
};

// Fixed hue per method so a method keeps its color across days (mirrors Reports).
// Unmapped methods fall back to the donut's auto palette.
const METHOD_COLORS: Record<string, string> = {
  cash: "var(--chart-1)",
  telebirr: "var(--chart-2)",
  bank: "var(--chart-3)",
  mobile_money: "var(--chart-4)",
};

/** Hour 14 → "2–3 PM"; a compact label for the busiest trading hour. */
function hourRange(hour: number): string {
  const fmt = (h: number) => {
    const period = h < 12 || h === 24 ? "AM" : "PM";
    const twelve = h % 12 === 0 ? 12 : h % 12;
    return { twelve, period };
  };
  const a = fmt(hour);
  const b = fmt((hour + 1) % 24);
  return a.period === b.period
    ? `${a.twelve}–${b.twelve} ${b.period}`
    : `${a.twelve} ${a.period}–${b.twelve} ${b.period}`;
}

const LEVEL_VARIANT = {
  info: "secondary",
  warn: "warning",
  critical: "destructive",
} as const;

/** Local YYYY-MM-DD for today (no UTC slip). */
function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Shift a YYYY-MM-DD string by ±n days, staying on the local calendar. */
function shiftDay(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + delta);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

/** "2026-07-27" → "Sunday, Jul 27, 2026", parsed as a local date. */
function longDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** ISO datetime → "09:14" local time. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function MyDayPage() {
  const shop = useActiveShop();
  const currency = shop?.currency ?? "ETB";
  const today = todayIso();
  const [date, setDate] = useState(today);
  const { data, isLoading, isError, refetch } = useDayBook(date, true);

  const isToday = date === today;
  const s = data?.summary;

  // A day where nothing at all happened — show a calm "quiet day" note rather
  // than a wall of zeros that can read as broken.
  const isQuietDay =
    Boolean(data) &&
    s?.sales_count === 0 &&
    data!.expenses.length === 0 &&
    data!.activity.length === 0;

  // Insights derived from the day's sales — nothing invented, each shows only
  // when there is at least one sale to compute it from.
  const insights = useMemo(() => {
    if (!data || !s || data.sales.length === 0) return null;
    const avgSale = Math.round(s.sales_total / s.sales_count);
    const biggestSale = data.sales.reduce((m, x) => Math.max(m, x.total), 0);
    // Margin is profit over the shop's own (ex-tax) revenue, not the taxed total.
    const margin = s.net_sales > 0 ? Math.round((s.gross_profit / s.net_sales) * 100) : 0;
    const byHour = new Map<number, number>();
    for (const sale of data.sales) {
      const h = new Date(sale.created_at).getHours();
      byHour.set(h, (byHour.get(h) ?? 0) + 1);
    }
    let busiest = -1;
    let busiestCount = 0;
    for (const [h, c] of byHour) {
      if (c > busiestCount) {
        busiest = h;
        busiestCount = c;
      }
    }
    return { avgSale, biggestSale, margin, busiest, busiestCount };
  }, [data, s]);

  return (
    <div>
      <PageHeader
        title="My Day"
        description="A full close for a single day — sales, profit, expenses, and activity."
        actions={
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        }
      />

      {/* Day stepper */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-md border bg-card">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-r-none"
            aria-label="Previous day"
            onClick={() => setDate((d) => shiftDay(d, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <EthiopianDatePicker
            value={date}
            max={today}
            onChange={(iso) => setDate(iso || today)}
            ariaLabel="Pick a day"
            className="w-40 border-y-0 border-x [&>button]:rounded-none [&>button]:border-y-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-l-none"
            aria-label="Next day"
            disabled={isToday}
            onClick={() => setDate((d) => shiftDay(d, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button
          variant={isToday ? "secondary" : "outline"}
          size="sm"
          onClick={() => setDate(today)}
          disabled={isToday}
        >
          Today
        </Button>
        <div className="ml-1 leading-tight">
          <span className="block text-sm font-medium">
            {data?.date_ethiopian ?? formatEthiopian(date)}
            <span className="ml-1 text-xs font-normal text-muted-foreground">Ethiopian</span>
          </span>
          <span className="block text-xs text-muted-foreground">{longDay(date)}</span>
        </div>
      </div>

      {isError ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <RefreshCw className="h-6 w-6" />
          </span>
          <div>
            <p className="font-medium">This day isn&apos;t ready yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              We couldn&apos;t reach your shop&apos;s data for {longDay(date)}. Check your
              connection and try again.
            </p>
          </div>
          <Button variant="default" size="sm" className="mt-1" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        </Card>
      ) : (
        <>
          {/* Quiet-day banner */}
          {isQuietDay && (
            <Card className="mb-4 flex items-center gap-3 border-dashed p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Coffee className="h-4 w-4" />
              </span>
              <p className="text-sm text-muted-foreground">
                {isToday
                  ? "Nothing recorded yet today — your first sale will show up here."
                  : "A quiet day — no sales, expenses, or activity were recorded."}
              </p>
            </Card>
          )}

          {/* Headline tiles */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Sales"
          icon={Receipt}
          value={s ? formatMoney(s.sales_total, currency) : undefined}
          sub={s ? `${s.sales_count} sale${s.sales_count === 1 ? "" : "s"} · ${s.items_sold} items` : ""}
          loading={isLoading}
        />
        <Kpi
          label="Gross profit"
          icon={TrendingUp}
          value={s ? formatMoney(s.gross_profit, currency) : undefined}
          sub="Net sales − cost of goods"
          loading={isLoading}
        />
        <Kpi
          label="Net profit"
          icon={Coins}
          value={s ? formatMoney(s.net_profit, currency) : undefined}
          sub={
            s
              ? s.monthly_prorated > 0
                ? `After ${formatMoney(s.expenses_total, currency)} expenses (today's share)`
                : `After ${formatMoney(s.expenses_total, currency)} expenses`
              : ""
          }
          loading={isLoading}
          negative={Boolean(s && s.net_profit < 0)}
        />
        <Kpi
          label="Cash taken"
          icon={Wallet}
          value={s ? formatMoney(s.cash_received, currency) : undefined}
          sub="Cash from today's sales"
          loading={isLoading}
        />
      </div>

      {/* Sales breakdown (how the customer's money splits: net + tax) alongside
          a profit breakdown (how that money becomes profit) — a mini daily P&L. */}
      {s && s.sales_count > 0 && (
        <div
          className={cn(
            "mt-4 grid gap-4",
            (s.tax_total > 0 || s.discount_total > 0) && "lg:grid-cols-2",
          )}
        >
          {(s.tax_total > 0 || s.discount_total > 0) && (
            <Card className="p-5">
              <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Sales breakdown
              </span>
              <dl className="mt-3 space-y-2 text-sm">
                <BreakdownRow label="Net sales" value={formatMoney(s.net_sales, currency)} />
                {s.discount_total > 0 && (
                  <BreakdownRow
                    label="Discounts"
                    value={`−${formatMoney(s.discount_total, currency)}`}
                  />
                )}
                <BreakdownRow
                  label="Tax collected"
                  hint="held for tax authority — not profit"
                  value={formatMoney(s.tax_total, currency)}
                />
                <div className="!mt-3 flex items-baseline justify-between border-t pt-2.5">
                  <dt className="font-medium">Total collected</dt>
                  <dd className="font-mono text-base font-semibold tabular-nums">
                    {formatMoney(s.sales_total, currency)}
                  </dd>
                </div>
              </dl>
            </Card>
          )}

          {/* Profit breakdown — a mini P&L: net sales → gross → net profit. */}
          <Card className="p-5">
            <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Profit breakdown
            </span>
            <dl className="mt-3 space-y-2 text-sm">
              <BreakdownRow label="Net sales" value={formatMoney(s.net_sales, currency)} />
              <BreakdownRow
                label="Cost of goods"
                value={`−${formatMoney(s.net_sales - s.gross_profit, currency)}`}
              />
              <div className="!mt-2.5 flex items-baseline justify-between border-t pt-2.5">
                <dt className="font-medium">Gross profit</dt>
                <dd className="font-mono font-semibold tabular-nums">
                  {formatMoney(s.gross_profit, currency)}
                </dd>
              </div>
              <BreakdownRow
                label="Expenses"
                hint="today's share"
                value={`−${formatMoney(s.expenses_total, currency)}`}
              />
              <div className="!mt-2.5 flex items-baseline justify-between border-t pt-2.5">
                <dt className="font-medium">Net profit</dt>
                <dd
                  className={cn(
                    "font-mono text-base font-semibold tabular-nums",
                    s.net_profit < 0 && "text-destructive",
                  )}
                >
                  {formatMoney(s.net_profit, currency)}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      )}

      {/* Insights — quick reads on how the day traded */}
      {insights && s && (
        <Card className="mt-4 p-4">
          <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Day insights
          </span>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MiniStat label="Avg / sale" value={formatMoney(insights.avgSale, currency)} />
            <MiniStat label="Biggest sale" value={formatMoney(insights.biggestSale, currency)} />
            <MiniStat
              label="Busiest hour"
              value={insights.busiest >= 0 ? hourRange(insights.busiest) : "—"}
              hint={insights.busiest >= 0 ? `${insights.busiestCount} sales` : undefined}
            />
            <MiniStat label="Gross margin" value={`${insights.margin}%`} hint="on net sales" />
          </div>
        </Card>
      )}

      {/* Payments donut + top products */}
      {data && (data.by_method.length > 0 || data.top_products.length > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Payments received">
            <DonutChart
              data={data.by_method.map((m) => ({
                name: METHOD_LABELS[m.method] ?? m.method,
                value: m.total,
                color: METHOD_COLORS[m.method],
              }))}
              currency={currency}
              totalLabel="Total received"
              maxSlices={6}
            />
            {s && s.settlements_received > 0 && (
              <div className="mt-2 flex items-baseline justify-between gap-2 border-t pt-2 text-sm">
                <span className="text-muted-foreground">
                  Credit settlements
                  <span className="ml-1 text-xs text-muted-foreground/70">(older debts paid)</span>
                </span>
                <span className="font-mono font-medium tabular-nums">
                  +{formatMoney(s.settlements_received, currency)}
                </span>
              </div>
            )}
          </ChartCard>

          <Section title="Top products" icon={Trophy} count={data.top_products.length}>
            {data.top_products.length > 0 ? (
              <ol className="space-y-2.5">
                {data.top_products.map((p, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      ×{p.quantity}
                    </span>
                    <span className="w-24 shrink-0 text-right font-mono text-sm font-semibold tabular-nums">
                      {formatMoney(p.revenue, currency)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty text="No products sold on this day." />
            )}
          </Section>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Sales of the day */}
        <Section title="Sales" icon={ShoppingBag} count={data?.sales.length}>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : data && data.sales.length > 0 ? (
            <ul className="divide-y">
              {data.sales.map((sale) => (
                <li key={sale.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {clock(sale.created_at)}
                    </span>
                    <p className="truncate text-sm">
                      {sale.customer_name ?? "Walk-in"}
                      <span className="text-muted-foreground">
                        {" "}
                        · {sale.item_count} line{sale.item_count === 1 ? "" : "s"}
                      </span>
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                    {formatMoney(sale.total, currency)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="No sales on this day." />
          )}
        </Section>

        {/* Expenses of the day — one-time in full, monthly overheads prorated */}
        <Section
          title="Expenses"
          icon={Receipt}
          count={
            data ? data.expenses.length + data.monthly_expenses.length : undefined
          }
        >
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : data && (data.expenses.length > 0 || data.monthly_expenses.length > 0) ? (
            <div className="space-y-3">
              {data.expenses.length > 0 && (
                <ul className="divide-y">
                  {data.expenses.map((e, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{e.category}</p>
                        {e.description && (
                          <p className="truncate text-xs text-muted-foreground">{e.description}</p>
                        )}
                      </div>
                      <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-destructive">
                        −{formatMoney(e.amount, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {data.monthly_expenses.length > 0 && (
                <div className="rounded-md border border-dashed p-3">
                  <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Monthly overheads · prorated over the Ethiopian month
                  </p>
                  <ul className="divide-y">
                    {data.monthly_expenses.map((e, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {e.category}
                            <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              monthly
                            </span>
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {formatMoney(e.amount, currency)} / month
                            {e.description ? ` · ${e.description}` : ""}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="font-mono text-sm font-semibold tabular-nums text-destructive">
                            −{formatMoney(e.per_day, currency)}
                          </span>
                          <p className="text-[10px] text-muted-foreground">today&apos;s share</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {s && (
                <div className="flex items-baseline justify-between border-t pt-2.5 text-sm">
                  <span className="font-medium">Charged to today</span>
                  <span className="font-mono font-semibold tabular-nums text-destructive">
                    −{formatMoney(s.expenses_total, currency)}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <Empty text="No expenses on this day." />
          )}
        </Section>
      </div>

      {/* Activity trail */}
      <Section title="Activity" icon={ScrollText} count={data?.activity.length} className="mt-4">
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : data && data.activity.length > 0 ? (
          <ul className="divide-y">
            {data.activity.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {clock(a.created_at)}
                  </span>
                  <span className="truncate text-sm font-medium">{a.action}</span>
                  <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                    {a.user_email ?? "—"}
                  </span>
                </div>
                <Badge variant={LEVEL_VARIANT[a.level]}>{a.level}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="No activity on this day." />
        )}
      </Section>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  icon: Icon,
  value,
  sub,
  loading,
  negative = false,
}: {
  label: string;
  icon: typeof Receipt;
  value?: string;
  sub?: string;
  loading: boolean;
  negative?: boolean;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {loading || value === undefined ? (
        <Skeleton className="mt-3 h-7 w-24" />
      ) : (
        <div
          className={cn(
            "mt-3 font-mono text-[22px] font-semibold leading-none tabular-nums sm:text-[26px]",
            negative && "text-destructive",
          )}
        >
          {value}
        </div>
      )}
      {sub && <p className="mt-2 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

function Section({
  title,
  icon: Icon,
  count,
  className,
  children,
}: {
  title: string;
  icon: typeof Receipt;
  count?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="mb-1 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="font-mono text-xs text-muted-foreground">({count})</span>
        )}
      </div>
      {children}
    </Card>
  );
}

function BreakdownRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">
        {label}
        {hint && <span className="ml-1.5 text-xs text-muted-foreground/70">({hint})</span>}
      </dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-sm font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;
}
