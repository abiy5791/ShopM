import { Pencil, Trash2 } from "lucide-react";

import { DetailField } from "@/components/detail";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatEthiopian } from "@/lib/ethiopian";
import { formatMoney } from "@/lib/money";
import type { Expense } from "@/types";

/** One expense in full — useful on a phone where the table is cramped. Delete
 *  is surfaced here so the row itself stays tap-to-open. */
export function ExpenseDetailDialog({
  expense,
  currency,
  onOpenChange,
  onEdit,
  onDelete,
  onViewReceipt,
}: {
  expense: Expense | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onViewReceipt: (url: string) => void;
}) {
  if (!expense) return null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-6">Expense · {formatMoney(expense.amount, currency)}</DialogTitle>
        </DialogHeader>

        <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-2">
          <DetailField label="Date">{formatEthiopian(expense.date)}</DetailField>
          <DetailField label="Category">{expense.category_name ?? "—"}</DetailField>
          <DetailField label="Frequency">
            {expense.recurrence === "monthly" ? "Monthly (prorated daily)" : "One-time"}
          </DetailField>
          <div className="sm:col-span-2">
            <DetailField label="Description">{expense.description || "—"}</DetailField>
          </div>
          <DetailField label="Receipt">
            {expense.receipt_image_url ? (
              <button
                type="button"
                onClick={() => onViewReceipt(expense.receipt_image_url!)}
                className="text-accent underline-offset-2 hover:underline"
              >
                View image
              </button>
            ) : (
              "—"
            )}
          </DetailField>
        </dl>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={onDelete} className="text-destructive">
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <Button onClick={onEdit}>
            <Pencil className="h-4 w-4" /> Edit expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
