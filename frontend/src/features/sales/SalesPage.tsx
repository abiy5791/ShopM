import { Ban, Receipt } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
import { useActiveShop } from "@/features/pos/api";
import { useAuthStore } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/utils";
import type { Sale } from "@/types";

import { useSales, useVoidSale } from "./api";
import { SaleDetailDialog } from "./SaleDetailDialog";

export default function SalesPage() {
  const shop = useActiveShop();
  const currency = shop?.currency ?? "ETB";
  const isOwner = useAuthStore(
    (s) => s.memberships.find((m) => m.shop_id === s.activeShopId)?.role === "owner",
  );
  const [page, setPage] = useState(1);
  const [voiding, setVoiding] = useState<Sale | null>(null);
  const [detail, setDetail] = useState<Sale | null>(null);
  const { data, isLoading, isError, refetch } = useSales(page);
  const voidSale = useVoidSale();
  const rows = data?.results ?? [];

  async function handleVoid(sale: Sale) {
    try {
      await voidSale.mutateAsync(sale.id);
      toast.success("Sale voided — stock restored");
    } catch {
      toast.error("Could not void this sale.");
    } finally {
      setVoiding(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Sales"
        description="Completed sales for this shop. Select a sale for full details."
      />

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-t-0">
              <TableHead>Time</TableHead>
              <TableHead>Cashier</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              {isOwner && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: isOwner ? 7 : 6 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!isLoading &&
              rows.map((sale) => (
                <TableRow
                  key={sale.id}
                  tabIndex={0}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => setDetail(sale)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDetail(sale);
                    }
                  }}
                >
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {formatDateTime(sale.created_at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {sale.cashier_email ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {sale.customer_name ?? "Walk-in"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {sale.items.reduce((units, item) => units + item.quantity, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatMoney(sale.total, currency)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={sale.status === "voided" ? "destructive" : "accent"}>
                      {sale.status}
                    </Badge>
                  </TableCell>
                  {isOwner && (
                    <TableCell>
                      {sale.status === "completed" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setVoiding(sale);
                          }}
                          aria-label="Void sale"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
          </TableBody>
        </Table>

        {!isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <Receipt className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {isError ? "Couldn't load sales." : "No sales yet"}
            </p>
            <p className="text-xs text-muted-foreground">Sales made at the POS will appear here.</p>
            {isError && (
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            )}
          </div>
        )}
      </Card>

      {data && data.count > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>{data.count} total</span>
          {(data.previous || data.next) && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!data.previous}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!data.next}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      <SaleDetailDialog
        sale={detail}
        currency={currency}
        onOpenChange={(o) => !o && setDetail(null)}
      />

      <ConfirmDialog
        open={voiding !== null}
        onOpenChange={(o) => !o && setVoiding(null)}
        title={voiding ? `Void this ${formatMoney(voiding.total, currency)} sale?` : "Void sale?"}
        description="The sale is marked voided and its stock is returned to inventory. This is recorded in the activity log."
        confirmLabel="Void sale"
        onConfirm={() => voiding && handleVoid(voiding)}
      />
    </div>
  );
}
