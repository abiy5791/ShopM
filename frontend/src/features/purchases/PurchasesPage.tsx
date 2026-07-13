import { Plus, Truck } from "lucide-react";
import { useState } from "react";

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
import { formatMoney } from "@/lib/money";
import type { PaymentStatus } from "@/types";

import { usePurchases } from "./api";
import { PurchaseFormDialog } from "./PurchaseFormDialog";

const STATUS_VARIANT: Record<PaymentStatus, "accent" | "secondary" | "destructive"> = {
  paid: "accent",
  partial: "secondary",
  unpaid: "destructive",
};

export default function PurchasesPage() {
  const shop = useActiveShop();
  const currency = shop?.currency ?? "ETB";
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, refetch } = usePurchases(page);
  const rows = data?.results ?? [];

  return (
    <div>
      <PageHeader
        title="Purchases"
        description="Record stock purchases from suppliers. Each purchase stocks items in."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> New purchase
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-t-0">
              <TableHead>Date</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!isLoading &&
              rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {p.date}
                  </TableCell>
                  <TableCell>{p.supplier_name ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.items.length}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatMoney(p.total, currency)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatMoney(p.amount_paid, currency)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[p.payment_status]}>{p.payment_status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>

        {!isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <Truck className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {isError ? "Couldn't load purchases." : "No purchases yet"}
            </p>
            <p className="text-xs text-muted-foreground">Record your first stock purchase.</p>
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

      <PurchaseFormDialog open={open} onOpenChange={setOpen} currency={currency} />
    </div>
  );
}
