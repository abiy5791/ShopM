import { ArrowLeft, Loader2, Pencil, Printer } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Receipt } from "@/features/pos/Receipt";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import type { Sale } from "@/types";

import { useSaleReceipt } from "./api";

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  telebirr: "Telebirr",
  cbe: "CBE",
  abyssinia: "Bank of Abyssinia",
  bank: "Bank",
  mobile_money: "Mobile money",
};

/** Everything about one sale: line items, totals, payments — plus a receipt
 *  reprint (v2 polish). Read-only; voiding stays on the table row. */
export function SaleDetailDialog({
  sale,
  currency,
  onOpenChange,
  onEdit,
}: {
  sale: Sale | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
  /** Owner-only. Omitted for a cashier, who cannot correct a recorded sale. */
  onEdit?: (sale: Sale) => void;
}) {
  const [view, setView] = useState<"details" | "receipt">("details");
  const receipt = useSaleReceipt(sale?.id ?? null, view === "receipt");

  // A newly opened sale always starts on the details view.
  useEffect(() => {
    if (sale) setView("details");
  }, [sale]);

  if (!sale) return null;

  const money = (v: number) => formatMoney(v, currency);
  const outstanding = sale.total - sale.amount_paid;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {view === "receipt" ? (
          <>
            <DialogHeader className="no-print">
              <DialogTitle>Receipt</DialogTitle>
            </DialogHeader>
            {receipt.isLoading && (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {receipt.isError && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Couldn't load the receipt.
              </p>
            )}
            {receipt.data && <Receipt data={receipt.data} />}
            <DialogFooter className="no-print">
              <Button variant="outline" onClick={() => setView("details")}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button onClick={() => window.print()} disabled={!receipt.data}>
                <Printer className="h-4 w-4" /> Print
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
                Sale · {money(sale.total)}
                <Badge variant={sale.status === "voided" ? "destructive" : "accent"}>
                  {sale.status}
                </Badge>
                {sale.is_backdated && <Badge variant="secondary">backdated</Badge>}
                {sale.is_amended && <Badge variant="secondary">corrected</Badge>}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {/* Who / when — one column on phones so long values (a cashier
                  email) have room to wrap; paired columns from sm up. */}
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-2">
                {/* The day the sale counts towards. When it was entered later
                    (a missed day recorded afterwards) the entry date is shown
                    too — the two together are the whole audit story. */}
                <Meta label="Date" value={formatDateTime(sale.occurred_at)} />
                <Meta label="Cashier" value={sale.cashier_email ?? "—"} />
                <Meta label="Customer" value={sale.customer_name ?? "Walk-in"} />
                {sale.is_backdated && (
                  <Meta label="Recorded on" value={formatDateTime(sale.created_at)} />
                )}
                {sale.voided_at && <Meta label="Voided" value={formatDateTime(sale.voided_at)} />}
              </dl>

              {/* Items — stacked receipt lines on phones, full table from sm up
                  (four money columns don't fit a phone width). */}
              <ul className="divide-y rounded-md border text-sm sm:hidden">
                {sale.items.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{item.name_snapshot}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {item.sku_snapshot}
                      </p>
                      <p className="mt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                        {item.quantity} × {money(item.unit_price_snapshot)}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono font-medium tabular-nums">
                      {money(item.line_total)}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="hidden rounded-md border sm:block">
                <Table>
                  <TableHeader>
                    <TableRow className="border-t-0">
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sale.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <span className="font-medium">{item.name_snapshot}</span>
                          <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                            {item.sku_snapshot}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {money(item.unit_price_snapshot)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {money(item.line_total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Totals — full width on phones, right-aligned ledger column from sm up */}
              <div className="space-y-1 text-sm sm:ml-auto sm:max-w-56">
                <TotalRow label="Subtotal" value={money(sale.subtotal)} />
                {sale.discount > 0 && (
                  <TotalRow label="Discount" value={`−${money(sale.discount)}`} />
                )}
                {sale.tax > 0 && <TotalRow label="Tax" value={money(sale.tax)} />}
                <div className="flex justify-between border-t pt-1 text-base font-semibold">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">{money(sale.total)}</span>
                </div>
                <TotalRow label="Paid" value={money(sale.amount_paid)} />
                {sale.change > 0 && <TotalRow label="Change" value={money(sale.change)} />}
                {outstanding > 0 && (
                  <div className="flex justify-between font-medium text-destructive">
                    <span>On credit</span>
                    <span className="font-mono tabular-nums">{money(outstanding)}</span>
                  </div>
                )}
              </div>

              {/* Payments */}
              {sale.payments.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Payments
                  </p>
                  <ul className="space-y-1 text-sm">
                    {sale.payments.map((p) => (
                      <li key={p.id} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0">
                          {METHOD_LABELS[p.method] ?? p.method}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {formatDateTime(p.received_at)}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono tabular-nums">{money(p.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {sale.notes && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Notes
                  </p>
                  <p className="text-sm text-muted-foreground">{sale.notes}</p>
                </div>
              )}

              {/* Correction history. The figures above are the sale as it stands
                  now; this is every change made to get there, and why. */}
              {sale.amendments.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Corrections
                  </p>
                  <ul className="space-y-2">
                    {sale.amendments.map((a) => (
                      <li key={a.id} className="rounded-md border px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <span className="font-medium">{a.reason}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(a.created_at)}
                            {a.user_name ? ` · ${a.user_name}` : ""}
                          </span>
                        </div>
                        <ul className="mt-1.5 space-y-0.5">
                          {a.changes.map((c, i) => (
                            <li key={i} className="text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">{c.field}:</span>{" "}
                              <span className="line-through">{c.from}</span>
                              {" → "}
                              <span className="text-foreground">{c.to}</span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {onEdit && sale.status === "completed" && (
                <Button variant="outline" onClick={() => onEdit(sale)}>
                  <Pencil className="h-4 w-4" /> Correct
                </Button>
              )}
              <Button onClick={() => setView("receipt")}>
                <Printer className="h-4 w-4" /> Print receipt
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:block">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right sm:text-left">{value}</dd>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}
