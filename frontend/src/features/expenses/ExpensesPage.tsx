import { Plus, Receipt, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ListCard } from "@/components/list-card";
import { PageHeader } from "@/components/page-header";
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
import type { Expense } from "@/types";

import { useDeleteExpense, useExpenses } from "./api";
import { ExpenseDetailDialog } from "./ExpenseDetailDialog";
import { ExpenseFormDialog } from "./ExpenseFormDialog";
import { ReceiptDialog } from "./ReceiptDialog";

export default function ExpensesPage() {
  const shop = useActiveShop();
  const currency = shop?.currency ?? "ETB";
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [detail, setDetail] = useState<Expense | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useExpenses(page);
  const del = useDeleteExpense();
  const rows = data?.results ?? [];

  async function handleDelete(id: string) {
    try {
      await del.mutateAsync(id);
      toast.success("Expense deleted");
    } catch {
      toast.error("Could not delete expense.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Track shop running costs."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> New expense
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
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead className="w-10" />
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
                rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {e.date}
                    </TableCell>
                    <TableCell>{e.category_name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{e.description || "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMoney(e.amount, currency)}
                    </TableCell>
                    <TableCell>
                      {e.receipt_image_url ? (
                        <button
                          type="button"
                          onClick={() => setReceipt(e.receipt_image_url)}
                          className="text-accent underline-offset-2 hover:underline"
                        >
                          View
                        </button>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground"
                        aria-label="Delete expense"
                        onClick={() => setDeleting(e.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
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
            rows.map((e) => (
              <li key={e.id}>
                <ListCard
                  onClick={() => setDetail(e)}
                  title={e.category_name ?? "Expense"}
                  subtitle={e.date}
                  meta={e.description ? <span className="truncate">{e.description}</span> : undefined}
                  trailing={
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {formatMoney(e.amount, currency)}
                    </span>
                  }
                />
              </li>
            ))}
        </ul>

        {!isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <Receipt className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {isError ? "Couldn't load expenses." : "No expenses yet"}
            </p>
            <p className="text-xs text-muted-foreground">Record your first expense.</p>
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

      <ExpenseFormDialog open={open} onOpenChange={setOpen} currency={currency} />
      <ExpenseDetailDialog
        expense={detail}
        currency={currency}
        onOpenChange={(o) => !o && setDetail(null)}
        onDelete={() => {
          const id = detail?.id ?? null;
          setDetail(null);
          setDeleting(id);
        }}
        onViewReceipt={(url) => {
          setDetail(null);
          setReceipt(url);
        }}
      />
      <ReceiptDialog url={receipt} onOpenChange={(o) => !o && setReceipt(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this expense?"
        description="It disappears from expense totals and reports. An admin can restore it."
        confirmLabel="Delete expense"
        onConfirm={() => deleting && handleDelete(deleting)}
      />
    </div>
  );
}
