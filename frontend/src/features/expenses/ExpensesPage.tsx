import { Plus, Receipt, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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

import { useDeleteExpense, useExpenses } from "./api";
import { ExpenseFormDialog } from "./ExpenseFormDialog";

export default function ExpensesPage() {
  const shop = useActiveShop();
  const currency = shop?.currency ?? "ETB";
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useExpenses(page);
  const del = useDeleteExpense();
  const rows = data?.results ?? [];

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this expense?")) return;
    try {
      await del.mutateAsync(id);
      toast.success("Expense deleted");
    } catch {
      toast.error("Could not delete expense.");
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
                      <a
                        href={e.receipt_image_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent underline-offset-2 hover:underline"
                      >
                        View
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => handleDelete(e.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>

        {!isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <Receipt className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {isError ? "Couldn't load expenses." : "No expenses yet"}
            </p>
            <p className="text-xs text-muted-foreground">Record your first expense.</p>
          </div>
        )}
      </Card>

      {data && data.count > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>{data.count} total</span>
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
        </div>
      )}

      <ExpenseFormDialog open={open} onOpenChange={setOpen} currency={currency} />
    </div>
  );
}
