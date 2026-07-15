import { DetailField } from "@/components/detail";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
import { formatMoney } from "@/lib/money";
import type { PaymentStatus, Purchase } from "@/types";

const STATUS_VARIANT: Record<PaymentStatus, "accent" | "secondary" | "destructive"> = {
  paid: "accent",
  partial: "secondary",
  unpaid: "destructive",
};

/** Everything about one stock purchase: line items, totals and payment status. */
export function PurchaseDetailDialog({
  purchase,
  currency,
  onOpenChange,
}: {
  purchase: Purchase | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
}) {
  if (!purchase) return null;
  const money = (v: number) => formatMoney(v, currency);
  const outstanding = purchase.total - purchase.amount_paid;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            Purchase · {money(purchase.total)}
            <Badge variant={STATUS_VARIANT[purchase.payment_status]}>
              {purchase.payment_status}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-2">
            <DetailField label="Date">{purchase.date}</DetailField>
            <DetailField label="Supplier">{purchase.supplier_name ?? "—"}</DetailField>
          </dl>

          {/* Stacked lines on phones; full table from sm up. */}
          <ul className="divide-y rounded-md border text-sm sm:hidden">
            {purchase.items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="break-words font-medium">{item.product_name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{item.product_sku}</p>
                  <p className="mt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                    {item.quantity} × {money(item.unit_cost)}
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
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchase.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <span className="font-medium">{item.product_name}</span>
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                        {item.product_sku}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {money(item.unit_cost)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {money(item.line_total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-1 text-sm sm:ml-auto sm:max-w-56">
            <div className="flex justify-between border-t pt-1 text-base font-semibold">
              <span>Total</span>
              <span className="font-mono tabular-nums">{money(purchase.total)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Paid</span>
              <span className="font-mono tabular-nums">{money(purchase.amount_paid)}</span>
            </div>
            {outstanding > 0 && (
              <div className="flex justify-between font-medium text-destructive">
                <span>Outstanding</span>
                <span className="font-mono tabular-nums">{money(outstanding)}</span>
              </div>
            )}
          </div>

          {purchase.notes && (
            <div>
              <p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Notes
              </p>
              <p className="text-sm text-muted-foreground">{purchase.notes}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
