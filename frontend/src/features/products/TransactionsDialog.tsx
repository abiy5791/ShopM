import { History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Product, TransactionType } from "@/types";

import { useProductTransactions } from "./api";

const TYPE_VARIANT: Record<TransactionType, "default" | "secondary" | "accent" | "destructive"> = {
  purchase: "accent",
  sale: "secondary",
  adjustment: "default",
  reconcile: "secondary",
  return_in: "accent",
  return_out: "destructive",
  damage: "destructive",
  expiry: "destructive",
};

export function TransactionsDialog({
  product,
  onOpenChange,
}: {
  product: Product | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = useProductTransactions(product?.id ?? null);
  const rows = data ?? [];

  return (
    <Dialog open={Boolean(product)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Stock history</DialogTitle>
          <DialogDescription>
            {product?.name} ({product?.sku}) — the append-only ledger for this product.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto rounded-md border">
          {/* Desktop table */}
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow className="border-t-0">
                  <TableHead>Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}

                {!isLoading &&
                  rows.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
                        {new Date(t.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={TYPE_VARIANT[t.type]}>{t.type}</Badge>
                      </TableCell>
                      <TableCell
                        className={
                          "text-right font-mono font-medium tabular-nums " +
                          (t.quantity < 0 ? "text-destructive" : "text-accent")
                        }
                      >
                        {t.quantity > 0 ? `+${t.quantity}` : t.quantity}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{t.user_email ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{t.notes || "—"}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y sm:hidden">
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="p-3">
                  <Skeleton className="h-10 w-full" />
                </li>
              ))}
            {!isLoading &&
              rows.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <Badge variant={TYPE_VARIANT[t.type]}>{t.type}</Badge>
                    <p className="mt-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                      {new Date(t.created_at).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">{t.user_email ?? "—"}</p>
                    {t.notes && (
                      <p className="mt-0.5 break-words text-xs text-muted-foreground">{t.notes}</p>
                    )}
                  </div>
                  <span
                    className={
                      "shrink-0 font-mono text-base font-semibold tabular-nums " +
                      (t.quantity < 0 ? "text-destructive" : "text-accent")
                    }
                  >
                    {t.quantity > 0 ? `+${t.quantity}` : t.quantity}
                  </span>
                </li>
              ))}
          </ul>

          {!isLoading && rows.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <History className="h-7 w-7 text-muted-foreground/50" />
              <p className="text-sm font-medium">No stock movements yet</p>
              <p className="text-xs text-muted-foreground">
                Adjustments, purchases and sales will appear here.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
