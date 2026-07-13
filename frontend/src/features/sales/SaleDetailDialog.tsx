import { ArrowLeft, Loader2, Printer } from "lucide-react";
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
  bank: "Bank",
  mobile_money: "Mobile money",
};

/** Everything about one sale: line items, totals, payments — plus a receipt
 *  reprint (v2 polish). Read-only; voiding stays on the table row. */
export function SaleDetailDialog({
  sale,
  currency,
  onOpenChange,
}: {
  sale: Sale | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
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
              <DialogTitle className="flex items-center gap-2">
                Sale · {money(sale.total)}
                <Badge variant={sale.status === "voided" ? "destructive" : "accent"}>
                  {sale.status}
                </Badge>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {/* Who / when */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <Meta label="Date" value={formatDateTime(sale.created_at)} />
                <Meta label="Cashier" value={sale.cashier_email ?? "—"} />
                <Meta label="Customer" value={sale.customer_name ?? "Walk-in"} />
                {sale.voided_at && <Meta label="Voided" value={formatDateTime(sale.voided_at)} />}
              </dl>

              {/* Items */}
              <div className="rounded-md border">
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

              {/* Totals */}
              <div className="ml-auto max-w-56 space-y-1 text-sm">
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
                      <li key={p.id} className="flex items-center justify-between">
                        <span>
                          {METHOD_LABELS[p.method] ?? p.method}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {formatDateTime(p.received_at)}
                          </span>
                        </span>
                        <span className="font-mono tabular-nums">{money(p.amount)}</span>
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
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
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
    <div className="flex justify-between gap-2 sm:block">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
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
