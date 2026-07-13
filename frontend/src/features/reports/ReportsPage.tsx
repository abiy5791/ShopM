import { Download, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  CashflowChart,
  ChartCard,
  DonutChart,
  HBarChart,
  MultiLineChart,
  TrendAreaChart,
} from "@/components/charts";
import { PageHeader } from "@/components/page-header";
import { defaultRange, QuickRangePicker } from "@/components/quick-range";
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
import { formatMoney } from "@/lib/money";
import type { ReportData } from "@/types";

import { downloadReport, type ReportKey, type ReportParams, useReport } from "./api";

const TABS: { key: ReportKey; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "inventory", label: "Inventory" },
  { key: "profit", label: "Profit" },
  { key: "cashflow", label: "Cash flow" },
];

const PERIODS = ["daily", "weekly", "monthly", "yearly"];

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  mobile_money: "Mobile money",
};

// Payment methods keep a fixed hue regardless of which one leads the period.
const METHOD_COLORS: Record<string, string> = {
  cash: "var(--chart-1)",
  bank: "var(--chart-3)",
  mobile_money: "var(--chart-4)",
};

export default function ReportsPage() {
  const [tab, setTab] = useState<ReportKey>("sales");
  const [period, setPeriod] = useState("daily");
  const [range, setRange] = useState(defaultRange());

  const params: ReportParams = { period, start: range.start, end: range.end };
  const { data, isLoading, isError, refetch } = useReport(tab, params);

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
        )}

        {tab !== "inventory" && <QuickRangePicker value={range} onChange={setRange} />}
      </div>

      {data && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
                data?.rows.map((row, ri) => (
                  <TableRow key={ri}>
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
                ))}
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
            sale is on customer credit. */}
        <ChartCard title="Payments received">
          <DonutChart
            data={(report.by_method ?? []).map((m) => ({
              name: METHOD_LABELS[m.method] ?? m.method,
              value: m.total,
              color: METHOD_COLORS[m.method],
            }))}
            currency={currency}
            totalLabel="Total received"
          />
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
    return (
      <div className="mb-4">
        <ChartCard title="Top sellers — last 30 days">
          <HBarChart
            data={(report.top_sellers ?? []) as unknown as Record<string, unknown>[]}
            dataKey="quantity"
            nameKey="name"
            name="Units sold"
          />
        </ChartCard>
      </div>
    );
  }

  return null;
}
