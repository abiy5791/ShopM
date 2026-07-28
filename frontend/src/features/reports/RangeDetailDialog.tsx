import { ChevronRight } from "lucide-react";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { DayDetailDialog } from "@/features/day/DayDetailDialog";
import { formatEthiopian } from "@/lib/ethiopian";
import { formatMoney } from "@/lib/money";
import type { SalesSeriesPoint } from "@/types";

import { useReport } from "./api";

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  telebirr: "Telebirr",
  cbe: "CBE",
  abyssinia: "Bank of Abyssinia",
  bank: "Bank",
  mobile_money: "Mobile money",
};

export interface RangeTarget {
  start: string;
  end: string;
  label: string;
}

/** Summary for a weekly/monthly/yearly bucket — totals, payment split, and the
 *  daily breakdown (each day drills into its own close). */
export function RangeDetailDialog({
  range,
  currency,
  onOpenChange,
}: {
  range: RangeTarget | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [dayDetail, setDayDetail] = useState<string | null>(null);
  const { data, isLoading } = useReport(
    "sales",
    { period: "daily", start: range?.start, end: range?.end },
    Boolean(range),
  );
  const days = (data?.series ?? []) as SalesSeriesPoint[];

  return (
    <>
      <Dialog open={Boolean(range)} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{range?.label}</DialogTitle>
            <DialogDescription>Sales for this period. Click a day for its detail.</DialogDescription>
          </DialogHeader>

          {isLoading || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="space-y-4">
              {/* Totals */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {data.summary.map((it) => (
                  <div key={it.label} className="rounded-md border p-3">
                    <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                      {it.label}
                    </p>
                    <p className="mt-1 font-mono text-base font-semibold tabular-nums">
                      {it.money ? formatMoney(it.value, currency) : it.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Payments by method */}
              {(data.by_method ?? []).length > 0 && (
                <div className="rounded-md border p-4">
                  <h3 className="mb-1 text-sm font-semibold">Payments received</h3>
                  <ul className="divide-y">
                    {(data.by_method ?? []).map((m) => (
                      <li key={m.method} className="flex items-center justify-between py-1.5 text-sm">
                        <span className="text-muted-foreground">
                          {METHOD_LABELS[m.method] ?? m.method}
                        </span>
                        <span className="font-mono tabular-nums">
                          {formatMoney(m.total, currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Daily breakdown */}
              <div className="rounded-md border p-4">
                <h3 className="mb-1 text-sm font-semibold">Day by day</h3>
                <ul className="divide-y">
                  {days.map((d) => (
                    <li key={d.date}>
                      <button
                        type="button"
                        disabled={d.count === 0}
                        onClick={() => setDayDetail(d.date)}
                        className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm transition-colors enabled:hover:bg-muted/50 disabled:opacity-50"
                      >
                        <span>{formatEthiopian(d.date)}</span>
                        <span className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">
                            {d.count} sale{d.count === 1 ? "" : "s"}
                          </span>
                          <span className="w-24 text-right font-mono font-semibold tabular-nums">
                            {formatMoney(d.total, currency)}
                          </span>
                          {d.count > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <DayDetailDialog
        date={dayDetail}
        currency={currency}
        onOpenChange={(o) => !o && setDayDetail(null)}
      />
    </>
  );
}
