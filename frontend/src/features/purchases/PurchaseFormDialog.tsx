import { AxiosError } from "axios";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
import { useProducts, useSuppliers } from "@/features/products/api";
import { formatMoney, parseMoney } from "@/lib/money";
import type { ApiError } from "@/types";

import { useCreatePurchase } from "./api";

const NONE = "none";

interface DraftLine {
  product: string;
  quantity: string;
  unitCost: string;
}

export function PurchaseFormDialog({
  open,
  onOpenChange,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
}) {
  const suppliers = useSuppliers();
  const products = useProducts({ page: 1 });
  const create = useCreatePurchase();

  const [supplier, setSupplier] = useState(NONE);
  const [amountPaid, setAmountPaid] = useState("0");
  const [lines, setLines] = useState<DraftLine[]>([{ product: "", quantity: "1", unitCost: "0" }]);
  const [error, setError] = useState<string | null>(null);

  const productList = products.data?.results ?? [];

  const total = useMemo(
    () =>
      lines.reduce(
        (sum, l) => sum + (parseMoney(l.unitCost, currency) || 0) * (Number(l.quantity) || 0),
        0,
      ),
    [lines, currency],
  );

  function update(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function reset() {
    setSupplier(NONE);
    setAmountPaid("0");
    setLines([{ product: "", quantity: "1", unitCost: "0" }]);
    setError(null);
  }

  async function submit() {
    setError(null);
    const items = lines
      .filter((l) => l.product)
      .map((l) => ({
        product: l.product,
        quantity: Number(l.quantity) || 0,
        unit_cost: parseMoney(l.unitCost, currency) || 0,
      }))
      .filter((l) => l.quantity > 0);
    if (items.length === 0) {
      setError("Add at least one product line.");
      return;
    }
    try {
      await create.mutateAsync({
        supplier: supplier === NONE ? null : supplier,
        items,
        amount_paid: parseMoney(amountPaid, currency) || 0,
      });
      toast.success("Purchase recorded — stock updated");
      reset();
      onOpenChange(false);
    } catch (err) {
      const data = (err as AxiosError<ApiError>).response?.data;
      setError(data?.detail ?? "Could not record the purchase.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New purchase</DialogTitle>
          <DialogDescription>Recording a purchase stocks the items in.</DialogDescription>
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

          <div className="space-y-1.5">
            <Label>Supplier</Label>
            <Select value={supplier} onValueChange={setSupplier}>
              <SelectTrigger>
                <SelectValue placeholder="No supplier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No supplier</SelectItem>
                {(suppliers.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Items</Label>
            {lines.map((line, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Select value={line.product} onValueChange={(v) => update(i, { product: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      {productList.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.sku})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-20">
                  <Input
                    type="number"
                    min={1}
                    aria-label="Quantity"
                    value={line.quantity}
                    onChange={(e) => update(i, { quantity: e.target.value })}
                  />
                </div>
                <div className="w-28">
                  <Input
                    inputMode="decimal"
                    aria-label="Unit cost"
                    placeholder={`Cost (${currency})`}
                    value={line.unitCost}
                    onChange={(e) => update(i, { unitCost: e.target.value })}
                  />
                </div>
                {lines.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setLines((prev) => [...prev, { product: "", quantity: "1", unitCost: "0" }])
              }
            >
              <Plus className="h-4 w-4" /> Add item
            </Button>
          </div>

          <div className="flex items-end justify-between gap-4">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="amount_paid">Amount paid ({currency})</Label>
              <Input
                id="amount_paid"
                inputMode="decimal"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
              />
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="font-mono text-lg font-semibold tabular-nums">
                {formatMoney(total, currency)}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Record purchase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
