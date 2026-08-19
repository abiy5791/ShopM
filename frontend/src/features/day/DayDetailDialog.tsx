import { ChevronRight, Trophy } from "lucide-react";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useSale } from "@/features/sales/api";
import { SaleDetailDialog } from "@/features/sales/SaleDetailDialog";
import { formatEthiopian } from "@/lib/ethiopian";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/types";

import { useDayBook } from "./api";

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  telebirr: "Telebirr",
  cbe: "CBE",
  abyssinia: "Bank of Abyssinia",
  bank: "Bank",
  mobile_money: "Mobile money",
};

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Drill-down for one day (opened from the Sales report table) — the same close
 *  as My Day, condensed into a dialog. `date` is a Gregorian ISO string. */
export function DayDetailDialog({
  date,
  currency,
  onOpenChange,
}: {
  date: string | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = useDayBook(date ?? "", Boolean(date));
  const s = data?.summary;
  const [saleId, setSaleId] = useState<string | null>(null);
  const sale = useSale(saleId);

  return (
    <>
      <Dialog open={Boolean(date)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{date ? formatEthiopian(date) : ""}</DialogTitle>
          <DialogDescription>Sales, profit, and payments for this day.</DialogDescription>
        </DialogHeader>

        {isLoading || !s ? (
          <Skeleton className="h-40 w-full" />
        ) : s.sales_count === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No sales were recorded on this day.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Headline numbers */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Sales" value={formatMoney(s.sales_total, currency)} sub={`${s.sales_count} sales · ${s.items_sold} items`} />
              <Stat label="Gross profit" value={formatMoney(s.gross_profit, currency)} />
              <Stat
                label="Net profit"
                value={formatMoney(s.net_profit, currency)}
                negative={s.net_profit < 0}
              />
              <Stat label="Cash taken" value={formatMoney(s.cash_received, currency)} />
            </div>

            {/* Payments by method */}
            {data && data.by_method.length > 0 && (
              <Panel title="Payments received">
                <ul className="divide-y">
                  {data.by_method.map((m) => (
                    <li key={m.method} className="flex items-center justify-between py-1.5 text-sm">
                      <span className="text-muted-foreground">
                        {METHOD_LABELS[m.method as PaymentMethod] ?? m.method}
                      </span>
                      <span className="font-mono tabular-nums">{formatMoney(m.total, currency)}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {/* Sales of the day */}
            <Panel title={`Sales (${data?.sales.length ?? 0})`}>
              <ul className="divide-y">
                {(data?.sales ?? []).map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setSaleId(row.id)}
                      className="flex w-full items-center justify-between gap-3 py-2 text-left transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {clock(row.occurred_at)}
                        </span>
                        <p className="truncate text-sm">
                          {row.customer_name ?? "Walk-in"}
                          <span className="text-muted-foreground">
                            {" "}
                            · {row.item_count} line{row.item_count === 1 ? "" : "s"}
                          </span>
                        </p>
                      </div>
                      <span className="flex shrink-0 items-center gap-1 font-mono text-sm font-semibold tabular-nums">
                        {formatMoney(row.total, currency)}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>

            {/* Top products */}
            {data && data.top_products.length > 0 && (
              <Panel title="Top products" icon={<Trophy className="h-4 w-4 text-muted-foreground" />}>
                <ol className="space-y-2">
                  {data.top_products.map((p, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        ×{p.quantity}
                      </span>
                      <span className="w-24 shrink-0 text-right font-mono font-semibold tabular-nums">
                        {formatMoney(p.revenue, currency)}
                      </span>
                    </li>
                  ))}
                </ol>
              </Panel>
            )}
          </div>
        )}
      </DialogContent>
      </Dialog>

      {/* Drill one level deeper: a single sale's full detail. */}
      <SaleDetailDialog
        sale={sale.data ?? null}
        currency={currency}
        onOpenChange={(o) => !o && setSaleId(null)}
      />
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  negative = false,
}: {
  label: string;
  value: string;
  sub?: string;
  negative?: boolean;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-base font-semibold tabular-nums",
          negative && "text-destructive",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-4">
      <div className="mb-1 flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}
