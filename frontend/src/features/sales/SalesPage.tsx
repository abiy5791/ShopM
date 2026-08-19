import { Ban, Pencil, Receipt } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { KpiRow } from "@/components/kpi";
import { ListCard, Fact } from "@/components/list-card";
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
import { useSummary } from "@/lib/summary";
import { formatDateTime } from "@/lib/utils";
import type { Sale } from "@/types";

import { useSales, useVoidSale } from "./api";
import { SaleDetailDialog } from "./SaleDetailDialog";
import { SaleEditDialog } from "./SaleEditDialog";

export default function SalesPage() {
  const shop = useActiveShop();
  const currency = shop?.currency ?? "ETB";
  const isOwner = useAuthStore(
    (s) => s.memberships.find((m) => m.shop_id === s.activeShopId)?.role === "owner",
  );
  const [page, setPage] = useState(1);
  const [voiding, setVoiding] = useState<Sale | null>(null);
  const [detail, setDetail] = useState<Sale | null>(null);
  const [editing, setEditing] = useState<Sale | null>(null);
  const { data, isLoading, isError, refetch } = useSales(page);
  // Owners get the shop's takings here; a cashier gets the same four figures
  // for their own sales only (plan §8).
  const summary = useSummary("sales");
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
        description={
          "Completed sales for this shop, by the day each counts towards. " +
          "Select a sale for full details."
        }
      />

      <KpiRow summary={summary.data} loading={summary.isLoading} />

      <Card className="overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="border-t-0">
              <TableHead>Sale date</TableHead>
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
                    {formatDateTime(sale.occurred_at)}
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
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant={sale.status === "voided" ? "destructive" : "accent"}>
                        {sale.status}
                      </Badge>
                      {/* Entered on a later day than it counts towards. */}
                      {sale.is_backdated && (
                        <Badge
                          variant="secondary"
                          title={`Recorded ${formatDateTime(sale.created_at)}`}
                        >
                          backdated
                        </Badge>
                      )}
                      {sale.is_amended && (
                        <Badge
                          variant="secondary"
                          title={`Corrected ${formatDateTime(sale.amended_at!)}`}
                        >
                          corrected
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  {isOwner && (
                    <TableCell>
                      {sale.status === "completed" && (
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditing(sale);
                            }}
                            aria-label="Correct sale"
                            title="Correct a sale that was recorded wrong"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setVoiding(sale);
                            }}
                            aria-label="Void sale"
                            title="Reverse a sale that never happened"
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
          </TableBody>
        </Table>
        </div>

        {/* Mobile cards */}
        <ul className="divide-y md:hidden">
          {isLoading &&
            Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="px-4 py-3">
                <Skeleton className="h-10 w-full" />
              </li>
            ))}
          {!isLoading &&
            rows.map((sale) => (
              <li key={sale.id}>
                <ListCard
                  onClick={() => setDetail(sale)}
                  title={sale.customer_name ?? "Walk-in"}
                  subtitle={formatDateTime(sale.occurred_at)}
                  meta={
                    <>
                      <Fact label="Items">
                        {sale.items.reduce((units, item) => units + item.quantity, 0)}
                      </Fact>
                      <Badge variant={sale.status === "voided" ? "destructive" : "accent"}>
                        {sale.status}
                      </Badge>
                      {sale.is_backdated && <Badge variant="secondary">backdated</Badge>}
                      {sale.is_amended && <Badge variant="secondary">corrected</Badge>}
                    </>
                  }
                  trailing={
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {formatMoney(sale.total, currency)}
                    </span>
                  }
                  actions={
                    isOwner && sale.status === "completed" ? (
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          aria-label="Correct sale"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(sale);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          aria-label="Void sale"
                          onClick={(e) => {
                            e.stopPropagation();
                            setVoiding(sale);
                          }}
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : undefined
                  }
                />
              </li>
            ))}
        </ul>

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
        onEdit={isOwner ? (s) => { setDetail(null); setEditing(s); } : undefined}
      />

      <SaleEditDialog
        sale={editing}
        currency={currency}
        onOpenChange={(o) => !o && setEditing(null)}
      />

      <ConfirmDialog
        open={voiding !== null}
        onOpenChange={(o) => !o && setVoiding(null)}
        title={voiding ? `Void this ${formatMoney(voiding.total, currency)} sale?` : "Void sale?"}
        description="Use this only when the sale never happened. It is marked voided, its stock returns to inventory, and it stops counting towards any day. To fix a sale that did happen but was recorded wrong, correct it instead."
        confirmLabel="Void sale"
        onConfirm={() => voiding && handleVoid(voiding)}
      />
    </div>
  );
}
