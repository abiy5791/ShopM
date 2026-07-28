import { AxiosError } from "axios";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EthiopianDatePicker } from "@/components/ethiopian-date-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { minorToInput, parseMoney } from "@/lib/money";
import type { ApiError, Expense, ExpenseRecurrence } from "@/types";

import { useCreateExpense, useExpenseCategories, useUpdateExpense } from "./api";

const NONE = "none";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function ExpenseFormDialog({
  open,
  onOpenChange,
  currency,
  expense = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  /** When provided, the dialog edits this expense instead of creating a new one. */
  expense?: Expense | null;
}) {
  const categories = useExpenseCategories();
  const create = useCreateExpense();
  const update = useUpdateExpense();
  const isEdit = Boolean(expense);

  const [category, setCategory] = useState(NONE);
  const [amount, setAmount] = useState("");
  const [recurrence, setRecurrence] = useState<ExpenseRecurrence>("one_time");
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Seed the fields each time the dialog opens: from the expense when editing,
  // blank when creating.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setFile(null);
    if (expense) {
      setCategory(expense.category ?? NONE);
      setAmount(minorToInput(expense.amount, currency));
      setRecurrence(expense.recurrence);
      setDate(expense.date);
      setDescription(expense.description);
    } else {
      setCategory(NONE);
      setAmount("");
      setRecurrence("one_time");
      setDate(today());
      setDescription("");
    }
  }, [open, expense, currency]);

  const pending = create.isPending || update.isPending;

  async function submit() {
    setError(null);
    const minor = parseMoney(amount || "0", currency);
    if (!Number.isFinite(minor) || minor <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    try {
      if (expense && !file) {
        // No new image → a clean JSON patch (lets the category be cleared to null).
        await update.mutateAsync({
          id: expense.id,
          body: {
            category: category === NONE ? null : category,
            amount: minor,
            recurrence,
            date,
            description,
          },
        });
      } else {
        const form = new FormData();
        if (category !== NONE) form.append("category", category);
        form.append("amount", String(minor));
        form.append("recurrence", recurrence);
        form.append("date", date);
        form.append("description", description);
        if (file) form.append("receipt_image", file);
        if (expense) {
          await update.mutateAsync({ id: expense.id, body: form });
        } else {
          await create.mutateAsync(form);
        }
      }
      toast.success(isEdit ? "Expense updated" : "Expense recorded");
      onOpenChange(false);
    } catch (err) {
      const data = (err as AxiosError<ApiError>).response?.data;
      const fieldMsg = data?.fields && Object.values(data.fields)[0]?.[0];
      setError(fieldMsg ?? data?.detail ?? "Could not save the expense.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit expense" : "New expense"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this expense. Changes flow through to My Day and reports."
              : "Record a shop expense, optionally with a receipt."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Uncategorised" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Uncategorised</SelectItem>
                  {(categories.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount ({currency})</Label>
              <Input
                id="amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>How often?</Label>
            <div className="flex rounded-md border bg-card p-0.5">
              {(
                [
                  { key: "one_time", label: "One-time" },
                  { key: "monthly", label: "Monthly" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setRecurrence(opt.key)}
                  className={
                    "flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors " +
                    (recurrence === opt.key
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-muted")
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {recurrence === "monthly"
                ? "A recurring monthly cost (salary, rent) — spread across the month in daily views."
                : "A one-off cost charged to its date."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="date">Date</Label>
            <EthiopianDatePicker id="date" value={date} max={today()} onChange={setDate} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="receipt">
              {isEdit ? "Replace receipt image (optional)" : "Receipt image (optional)"}
            </Label>
            <Input
              id="receipt"
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {isEdit && expense?.receipt_image_url && !file && (
              <p className="text-xs text-muted-foreground">
                A receipt is already attached — pick a file only to replace it.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Save expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
