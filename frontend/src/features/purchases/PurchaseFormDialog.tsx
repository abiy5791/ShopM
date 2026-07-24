import { AxiosError } from "axios";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { useAllProducts, useSuppliers } from "@/features/products/api";
import { formatMoney, minorToInput, parseMoney } from "@/lib/money";
import type { ApiError, Purchase } from "@/types";

import { useCreatePurchase, useUpdatePurchase } from "./api";

const NONE = "none";

interface DraftLine {
  product: string;
  quantity: string;
  unitCost: string;
}

const emptyLine = (): DraftLine => ({ product: "", quantity: "1", unitCost: "" });

export function PurchaseFormDialog({
  open,
  onOpenChange,
  currency,
  purchase,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  /** When set, the dialog edits this purchase instead of creating a new one. */
  purchase?: Purchase | null;
}) {
  const suppliers = useSuppliers();
  const products = useAllProducts();
  const create = useCreatePurchase();
  const update = useUpdatePurchase(purchase?.id ?? "");
  const isEdit = Boolean(purchase);
  const saving = create.isPending || update.isPending;

  const [supplier, setSupplier] = useState(NONE);
  const [amountPaid, setAmountPaid] = useState("0");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);

  const productList = products.data ?? [];

  // Prefill from the purchase (edit) or reset to blank (new) each time the
  // dialog opens, so a reused dialog instance never shows stale values.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (purchase) {
      setSupplier(purchase.supplier ?? NONE);
      setAmountPaid(minorToInput(purchase.amount_paid, currency));
      setLines(
        purchase.items.map((it) => ({
          product: it.product,
          quantity: String(it.quantity),
          unitCost: minorToInput(it.unit_cost, currency),
        })),
      );
    } else {
      setSupplier(NONE);
      setAmountPaid("0");
      setLines([emptyLine()]);
    }
  }, [open, purchase, currency]);

  const total = useMemo(
    () =>
      lines.reduce(
        (sum, l) => sum + (parseMoney(l.unitCost, currency) || 0) * (Number(l.quantity) || 0),
        0,
      ),
    [lines, currency],
  );
  const amountPaidMinor = parseMoney(amountPaid, currency) || 0;
  const outstanding = Math.max(0, total - amountPaidMinor);

  function update_(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  // Picking a product fills its default purchase price, unless the user already
  // typed a cost on that line.
  function selectProduct(i: number, productId: string) {
    const product = productList.find((p) => p.id === productId);
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        const keepCost = l.unitCost !== "" && l.unitCost !== "0";
        return {
          ...l,
          product: productId,
          unitCost: keepCost
            ? l.unitCost
            : product
              ? minorToInput(product.purchase_price, currency)
              : l.unitCost,
        };
      }),
    );
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
      setError("Add at least one product line with a quantity.");
      return;
    }
    const payload = {
      supplier: supplier === NONE ? null : supplier,
      items,
      amount_paid: parseMoney(amountPaid, currency) || 0,
    };
    try {
      if (isEdit) {
        await update.mutateAsync(payload);
        toast.success("Purchase updated — stock adjusted");
      } else {
        await create.mutateAsync(payload);
        toast.success("Purchase recorded — stock updated");
      }
      onOpenChange(false);
    } catch (err) {
      const data = (err as AxiosError<ApiError>).response?.data;
      setError(data?.detail ?? "Could not save the purchase.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit purchase" : "New purchase"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Changing the items adjusts stock by the difference."
              : "Pick the products you bought and how many — recording it stocks them in."}
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

            {/* Column headers so each field is labelled (sm+); stacked cards on phones. */}
            <div className="hidden grid-cols-[1fr_4.5rem_8rem_7rem_2.25rem] items-center gap-2 px-0.5 text-xs font-medium text-muted-foreground sm:grid">
              <span>Product</span>
              <span>Qty</span>
              <span>Unit cost ({currency})</span>
              <span className="text-right">Line total</span>
              <span className="sr-only">Remove</span>
            </div>

            {lines.map((line, i) => {
              const lineTotal =
                (parseMoney(line.unitCost, currency) || 0) * (Number(line.quantity) || 0);
              return (
                <div
                  key={i}
                  className="space-y-3 rounded-lg border p-3 sm:grid sm:grid-cols-[1fr_4.5rem_8rem_7rem_2.25rem] sm:items-center sm:gap-2 sm:space-y-0 sm:rounded-none sm:border-0 sm:p-0"
                >
                  {/* Product — full width on phones, first cell on desktop */}
                  <div>
                    <span className="mb-1 block text-xs font-medium text-muted-foreground sm:hidden">
                      Product
                    </span>
                    <Select value={line.product} onValueChange={(v) => selectProduct(i, v)}>
                      <SelectTrigger aria-label="Product">
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

                  {/* Qty + unit cost: side-by-side on phones; flow into the row on desktop */}
                  <div className="grid grid-cols-2 gap-3 sm:contents">
                    <div>
                      <span className="mb-1 block text-xs font-medium text-muted-foreground sm:hidden">
                        Qty
                      </span>
                      <Input
                        type="number"
                        min={1}
                        aria-label="Quantity"
                        value={line.quantity}
                        onChange={(e) => update_(i, { quantity: e.target.value })}
                      />
                    </div>
                    <div>
                      <span className="mb-1 block text-xs font-medium text-muted-foreground sm:hidden">
                        Unit cost ({currency})
                      </span>
                      <Input
                        inputMode="decimal"
                        aria-label="Unit cost"
                        placeholder="0.00"
                        value={line.unitCost}
                        onChange={(e) => update_(i, { unitCost: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Line total + remove: a footer row on phones; two cells on desktop */}
                  <div className="flex items-center justify-between border-t pt-3 sm:contents sm:border-0 sm:pt-0">
                    <div className="font-mono text-sm tabular-nums sm:text-right">
                      <span className="text-xs font-medium text-muted-foreground sm:hidden">
                        Line total{" "}
                      </span>
                      {formatMoney(lineTotal, currency)}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground sm:justify-self-end"
                      aria-label="Remove item"
                      disabled={lines.length === 1}
                      onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
            >
              <Plus className="h-4 w-4" /> Add item
            </Button>
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="amount_paid">Amount paid ({currency})</Label>
              <Input
                id="amount_paid"
                inputMode="decimal"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave this below the total to record what you still owe the supplier.
              </p>
            </div>

            {/* Live summary — total, paid and what's left, right-aligned on all sizes. */}
            <dl className="space-y-1 rounded-lg bg-muted/60 px-3.5 py-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Total</dt>
                <dd className="font-mono text-base font-semibold tabular-nums">
                  {formatMoney(total, currency)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Paid</dt>
                <dd className="font-mono tabular-nums text-muted-foreground">
                  {formatMoney(amountPaidMinor, currency)}
                </dd>
              </div>
              {outstanding > 0 && (
                <div className="flex items-center justify-between font-medium text-destructive">
                  <dt>Still owed</dt>
                  <dd className="font-mono tabular-nums">{formatMoney(outstanding, currency)}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : "Record purchase"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
