import { Plus, Truck } from "lucide-react";
import { useState } from "react";

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
import { formatEthiopian } from "@/lib/ethiopian";
import { formatMoney } from "@/lib/money";
import type { PaymentStatus, Purchase } from "@/types";

import { usePurchases } from "./api";
import { PurchaseDetailDialog } from "./PurchaseDetailDialog";
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
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [detail, setDetail] = useState<Purchase | null>(null);
  const { data, isLoading, isError, refetch } = usePurchases(page);
  const rows = data?.results ?? [];

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(purchase: Purchase) {
    setDetail(null); // close the detail view before opening the editor
    setEditing(purchase);
    setFormOpen(true);
  }

  return (
    <div>
      <PageHeader
        title="Purchases"
        description="Record stock purchases from suppliers. Each purchase stocks items in."
        actions={
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4" /> New purchase
          </Button>
        }
      />

      <Card className="overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block">
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
                  <TableRow
                    key={p.id}
                    tabIndex={0}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => setDetail(p)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetail(p);
                      }
                    }}
                  >
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {formatEthiopian(p.date)}
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
        </div>

        {/* Mobile cards */}
        <ul className="divide-y md:hidden">
          {isLoading &&
            Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="px-4 py-3">
                <Skeleton className="h-10 w-full" />
              </li>
            ))}
          {!isLoading &&
            rows.map((p) => (
              <li key={p.id}>
                <ListCard
                  onClick={() => setDetail(p)}
                  title={p.supplier_name ?? "Purchase"}
                  subtitle={formatEthiopian(p.date)}
                  meta={
                    <>
                      <Fact label="Items">{p.items.length}</Fact>
                      <Badge variant={STATUS_VARIANT[p.payment_status]}>{p.payment_status}</Badge>
                    </>
                  }
                  trailing={
                    <>
                      <span className="font-mono text-sm font-semibold tabular-nums">
                        {formatMoney(p.total, currency)}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {formatMoney(p.amount_paid, currency)} paid
                      </span>
                    </>
                  }
                />
              </li>
            ))}
        </ul>

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

      <PurchaseFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        currency={currency}
        purchase={editing}
      />
      <PurchaseDetailDialog
        purchase={detail}
        currency={currency}
        onOpenChange={(o) => !o && setDetail(null)}
        onEdit={openEdit}
      />
    </div>
  );
}
