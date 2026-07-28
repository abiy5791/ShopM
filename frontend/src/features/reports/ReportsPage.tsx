import { Download, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  CashflowChart,
  ChartCard,
  DonutChart,
  MultiLineChart,
  TrendAreaChart,
} from "@/components/charts";
import { PageHeader } from "@/components/page-header";
import { RankedBarList } from "@/components/ranked-bar-list";
import { QuickRangePicker } from "@/components/quick-range";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DayDetailDialog } from "@/features/day/DayDetailDialog";
import { useActiveShop } from "@/features/pos/api";
import { formatEthiopian } from "@/lib/ethiopian";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ReportData, SalesSeriesPoint } from "@/types";

import { RangeDetailDialog, type RangeTarget } from "./RangeDetailDialog";

import { downloadReport, type ReportKey, type ReportParams, useReport } from "./api";

const TABS: { key: ReportKey; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "inventory", label: "Inventory" },
  { key: "profit", label: "Profit" },
  { key: "cashflow", label: "Cash flow" },
];

const PERIODS = ["daily", "weekly", "monthly", "yearly"];

function isoLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// When no explicit From/To is chosen, the grouping picks a sensible lookback
// window, so coarser grouping reports over more time (and every figure rescopes).
const AUTO_WINDOW: Record<string, { label: string; back: (d: Date) => void }> = {
  daily: { label: "last 30 days", back: (d) => d.setDate(d.getDate() - 29) },
  weekly: { label: "last 12 weeks", back: (d) => d.setDate(d.getDate() - 83) },
  monthly: { label: "last 12 months", back: (d) => d.setFullYear(d.getFullYear() - 1) },
  yearly: { label: "last 5 years", back: (d) => d.setFullYear(d.getFullYear() - 5) },
};

function autoRangeForPeriod(period: string): { start: string; end: string } {
  const today = new Date();
  const start = new Date(today);
  (AUTO_WINDOW[period] ?? AUTO_WINDOW.daily).back(start);
  return { start: isoLocal(start), end: isoLocal(today) };
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  telebirr: "Telebirr",
  cbe: "CBE",
  abyssinia: "Bank of Abyssinia",
  bank: "Bank",
  mobile_money: "Mobile money",
};

// Payment methods keep a fixed hue regardless of which one leads the period.
// Unmapped methods (cbe, abyssinia) fall back to the donut's auto palette.
const METHOD_COLORS: Record<string, string> = {
  cash: "var(--chart-1)",
  telebirr: "var(--chart-2)",
  bank: "var(--chart-3)",
  mobile_money: "var(--chart-4)",
};

export default function ReportsPage() {
  const [tab, setTab] = useState<ReportKey>("sales");
  const [period, setPeriod] = useState("daily");
  const [range, setRange] = useState({ start: "", end: "" });
  const [dayDetail, setDayDetail] = useState<string | null>(null);
  const [rangeDetail, setRangeDetail] = useState<RangeTarget | null>(null);
  const currency = useActiveShop()?.currency ?? "ETB";

  // With no From/To set, the Sales grouping drives the window (so the totals,
  // payments, chart and table all change with Group by). An explicit range wins.
  const rangeIsSet = Boolean(range.start || range.end);
  const autoRange = !rangeIsSet && tab === "sales" ? autoRangeForPeriod(period) : null;
  const params: ReportParams = {
    period,
    start: range.start || autoRange?.start,
    end: range.end || autoRange?.end,
  };
  const { data, isLoading, isError, refetch } = useReport(tab, params);

  // Sales rows drill down: a daily row opens that day's full close; a
  // weekly/monthly/yearly row opens a summary for its date range. rows and
  // series are row-aligned, so series[i] carries the date/range for rows[i].
  const salesDrillEnabled = tab === "sales";
  const seriesPoints = salesDrillEnabled
    ? ((data?.series as SalesSeriesPoint[] | undefined) ?? [])
    : [];

  async function handleDownload(format: "pdf" | "xlsx") {
    try {
      await downloadReport(tab, format, params);
    } catch {
      toast.error("Export failed.");
    }
  }

  const moneyCols = new Set(data?.money_columns ?? []);

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Shop-scoped, date-ranged. Export to PDF or Excel."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => handleDownload("pdf")}>
              <Download className="h-4 w-4" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleDownload("xlsx")}>
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as ReportKey)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {tab === "sales" && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Group by
            </span>
            <div className="flex rounded-md border bg-card p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={
                    "rounded px-2.5 py-1.5 text-xs font-medium capitalize transition-colors " +
                    (period === p ? "bg-secondary text-secondary-foreground" : "hover:bg-muted")
                  }
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab !== "inventory" && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Date range
            </span>
            <QuickRangePicker value={range} onChange={setRange} showPresets={false} />
          </div>
        )}
      </div>

      {autoRange && (
        <p className="mb-3 text-xs text-muted-foreground">
          Showing{" "}
          <span className="font-medium text-foreground">
            {AUTO_WINDOW[period]?.label ?? "last 30 days"}
          </span>{" "}
          <span className="font-mono">
            ({formatEthiopian(autoRange.start)} – {formatEthiopian(autoRange.end)})
          </span>{" "}
          — pick a From/To to set your own range.
        </p>
      )}

      {data && (
        <div
          className={cn(
            "mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3",
            data.summary.length >= 5 ? "lg:grid-cols-5" : "lg:grid-cols-4",
          )}
        >
          {data.summary.map((s) => (
            <Card key={s.label} className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
                {s.money ? formatMoney(s.value, data.currency) : s.value}
              </p>
            </Card>
          ))}
        </div>
      )}

      {data && !isLoading && <ReportCharts report={data} />}
      {isLoading && <Skeleton className="mb-4 h-64 w-full" />}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-t-0">
                {(data?.columns ?? ["", "", ""]).map((c, i) => (
                  <TableHead key={i} className={i > 0 ? "text-right" : ""}>
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 3 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!isLoading &&
                data?.rows.map((row, ri) => {
                  const point = salesDrillEnabled ? seriesPoints[ri] : undefined;
                  const onRowClick = point
                    ? () =>
                        period === "daily"
                          ? setDayDetail(point.date)
                          : setRangeDetail({
                              start: point.start ?? point.date,
                              end: point.end ?? point.date,
                              label: String(row[0]),
                            })
                    : undefined;
                  return (
                    <TableRow
                      key={ri}
                      onClick={onRowClick}
                      className={onRowClick ? "cursor-pointer" : undefined}
                    >
                      {row.map((cell, ci) => (
                        <TableCell
                          key={ci}
                          className={ci > 0 ? "text-right font-mono tabular-nums" : ""}
                        >
                          {moneyCols.has(ci) && typeof cell === "number"
                            ? formatMoney(cell, data.currency)
                            : cell}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>

        {!isLoading && (!data || data.rows.length === 0) && (
          <div className="px-4 py-16 text-center text-sm text-muted-foreground">
            {isError ? (
              <div className="space-y-3">
                <p>Couldn't load the report.</p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            ) : (
              "No data for this period."
            )}
          </div>
        )}
      </Card>

      {salesDrillEnabled && data && data.rows.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Tip: click a {period === "daily" ? "day" : "period"} to see its full detail.
        </p>
      )}

      <DayDetailDialog
        date={dayDetail}
        currency={currency}
        onOpenChange={(o) => !o && setDayDetail(null)}
      />
      <RangeDetailDialog
        range={rangeDetail}
        currency={currency}
        onOpenChange={(o) => !o && setRangeDetail(null)}
      />
    </div>
  );
}

/** The chart block for each report type (v2 plan §4). */
function ReportCharts({ report }: { report: ReportData }) {
  const currency = report.currency;
  const series = (report.series ?? []) as unknown as Record<string, unknown>[];

  if (report.key === "sales") {
    return (
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Revenue over time">
            <TrendAreaChart data={series} dataKey="total" name="Revenue" currency={currency} />
          </ChartCard>
        </div>
        {/* Money actually received — differs from Total sales when part of a
            sale is on customer credit, so the gap is spelled out below. */}
        <ChartCard title="Payments received">
          <DonutChart
            data={(report.by_method ?? []).map((m) => ({
              name: METHOD_LABELS[m.method] ?? m.method,
              value: m.total,
              color: METHOD_COLORS[m.method],
            }))}
            currency={currency}
            totalLabel="Total received"
            maxSlices={6}
          />
          {Boolean(report.unpaid_credit) && (
            <dl className="mt-2 space-y-1.5 border-t pt-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">
                  On credit
                  <span className="ml-1 text-xs text-muted-foreground/70">(not yet collected)</span>
                </dt>
                <dd className="font-mono tabular-nums">
                  +{formatMoney(report.unpaid_credit ?? 0, currency)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2 border-t pt-1.5">
                <dt className="font-medium">Total sales</dt>
                <dd className="font-mono font-semibold tabular-nums">
                  {formatMoney(report.summary[0]?.value ?? 0, currency)}
                </dd>
              </div>
            </dl>
          )}
        </ChartCard>
      </div>
    );
  }

  if (report.key === "profit") {
    return (
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard title="Revenue vs. costs vs. net profit">
            <MultiLineChart
              data={series}
              currency={currency}
              series={[
                { dataKey: "revenue", name: "Revenue", color: "var(--chart-1)" },
                { dataKey: "expenses", name: "Expenses", color: "var(--chart-2)" },
                { dataKey: "net", name: "Net profit", color: "var(--chart-3)" },
              ]}
            />
          </ChartCard>
        </div>
        <ChartCard title="Expenses by category">
          <DonutChart
            data={(report.by_category ?? []).map((c) => ({ name: c.category, value: c.total }))}
            currency={currency}
          />
        </ChartCard>
      </div>
    );
  }

  if (report.key === "cashflow") {
    return (
      <div className="mb-4">
        <ChartCard title="Cash in / out with running balance">
          <CashflowChart data={series} currency={currency} />
        </ChartCard>
      </div>
    );
  }

  if (report.key === "inventory") {
    const sv = report.stock_value;
    return (
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Top sellers — last 30 days">
          <RankedBarList
            items={(report.top_sellers ?? []).map((t) => ({ name: t.name, value: t.quantity }))}
            formatValue={(v) => `${v} sold`}
            emptyText="No sales in this period."
          />
        </ChartCard>

        {sv && (
          <Card className="p-5">
            <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Stock value · if all sold
            </span>
            <dl className="mt-3 space-y-2 text-sm">
              <SvRow label="Stock at cost" value={formatMoney(sv.at_cost, currency)} />
              <SvRow label="Expected sales" value={formatMoney(sv.expected_sales, currency)} />
              <div className="!mt-2.5 flex items-baseline justify-between border-t pt-2.5">
                <dt className="font-medium">Potential gross profit</dt>
                <dd className="font-mono font-semibold tabular-nums text-accent">
                  {formatMoney(sv.potential_profit, currency)}
                </dd>
              </div>
              {sv.tax_rate > 0 && (
                <SvRow
                  label={`Expected tax (${sv.tax_rate}%)`}
                  value={`+${formatMoney(sv.expected_tax, currency)}`}
                />
              )}
              <div className="!mt-2.5 flex items-baseline justify-between border-t pt-2.5">
                <dt className="font-medium">Total if all sold</dt>
                <dd className="font-mono text-base font-semibold tabular-nums">
                  {formatMoney(sv.total_if_sold, currency)}
                </dd>
              </div>
            </dl>
          </Card>
        )}
      </div>
    );
  }

  return null;
}

function SvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}
