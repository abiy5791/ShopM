import { Download, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/money";

import { downloadReport, type ReportKey, type ReportParams, useReport } from "./api";

const TABS: { key: ReportKey; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "inventory", label: "Inventory" },
  { key: "profit", label: "Profit" },
  { key: "cashflow", label: "Cash flow" },
];

const PERIODS = ["daily", "weekly", "monthly", "yearly"];

export default function ReportsPage() {
  const [tab, setTab] = useState<ReportKey>("sales");
  const [period, setPeriod] = useState("daily");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const params: ReportParams = { period, start, end };
  const { data, isLoading, isError } = useReport(tab, params);

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
        <div className="flex rounded-md border bg-card p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={
                "rounded px-3 py-1.5 text-sm font-medium transition-colors " +
                (tab === t.key ? "bg-primary text-primary-foreground" : "hover:bg-muted")
              }
            >
              {t.label}
            </button>
          ))}
        </div>

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

        {tab !== "inventory" && (
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor="start" className="text-xs">
                From
              </Label>
              <Input
                id="start"
                type="date"
                className="h-8"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="end" className="text-xs">
                To
              </Label>
              <Input
                id="end"
                type="date"
                className="h-8"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
        )}
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

      <Card className="overflow-hidden">
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

        {!isLoading && (!data || data.rows.length === 0) && (
          <div className="px-4 py-16 text-center text-sm text-muted-foreground">
            {isError ? "Couldn't load the report." : "No data for this period."}
          </div>
        )}
      </Card>
    </div>
  );
}
