import { AxiosError } from "axios";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { parseMoney } from "@/lib/money";
import type { ApiError } from "@/types";

import { useCreateExpense, useExpenseCategories } from "./api";

const NONE = "none";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function ExpenseFormDialog({
  open,
  onOpenChange,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
}) {
  const categories = useExpenseCategories();
  const create = useCreateExpense();

  const [category, setCategory] = useState(NONE);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCategory(NONE);
    setAmount("");
    setDate(today());
    setDescription("");
    setFile(null);
    setError(null);
  }

  async function submit() {
    setError(null);
    const minor = parseMoney(amount || "0", currency);
    if (!Number.isFinite(minor) || minor <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    const form = new FormData();
    if (category !== NONE) form.append("category", category);
    form.append("amount", String(minor));
    form.append("date", date);
    form.append("description", description);
    if (file) form.append("receipt_image", file);
    try {
      await create.mutateAsync(form);
      toast.success("Expense recorded");
      reset();
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
          <DialogTitle>New expense</DialogTitle>
          <DialogDescription>Record a shop expense, optionally with a receipt.</DialogDescription>
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
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
            <Label htmlFor="receipt">Receipt image (optional)</Label>
            <Input
              id="receipt"
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
