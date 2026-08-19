import { AlertTriangle, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { useCustomers } from "@/features/customers/api";
import { useAllProducts } from "@/features/products/api";
import { stockShortages, useSaleDateWindow } from "@/features/pos/api";
import { formatMoney, minorToInput, parseMoney } from "@/lib/money";
import type { PaymentMethod, Product, Sale } from "@/types";

import { useEditSale } from "./api";
import { buildEditPayload, changeCount, isoDay } from "./editPayload";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "telebirr", label: "Telebirr" },
  { value: "cbe", label: "CBE" },
  { value: "abyssinia", label: "Bank of Abyssinia" },
  { value: "bank", label: "Bank" },
  { value: "mobile_money", label: "Mobile money" },
];

/** A line being edited. `productId` is fixed — an owner changes what was sold by
 *  removing the line and ringing a new sale, not by silently swapping the item. */
interface EditLine {
  productId: string;
  name: string;
  sku: string;
  quantity: string;
  unitPrice: string;
}

interface EditPayment {
  method: PaymentMethod;
  amount: string;
}

/**
 * Correct a sale that was recorded wrong — the wrong quantity, the wrong price,
 * the wrong payment method, the wrong day or customer.
 *
 * This is deliberately not a free-form rewrite. It edits what a shop actually
 * gets wrong at the counter, always requires a reason, and only submits the
 * fields that changed, so the amendment history reads as a short list of real
 * corrections rather than a diff of everything. A sale that never happened at
 * all should be voided instead.
 */
export function SaleEditDialog({
  sale,
  currency,
  onOpenChange,
}: {
  sale: Sale | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
}) {
  const editSale = useEditSale();
  const customers = useCustomers();
  const products = useAllProducts();
  const dateWindow = useSaleDateWindow();

  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<EditLine[]>([]);
  const [payments, setPayments] = useState<EditPayment[]>([]);
  const [customerId, setCustomerId] = useState("none");
  const [discount, setDiscount] = useState("");
  const [tax, setTax] = useState("");
  const [saleDate, setSaleDate] = useState("");
  const [productQuery, setProductQuery] = useState("");

  // Re-seed from the sale every time a different one is opened, so the form
  // always starts as an exact picture of what is currently recorded.
  useEffect(() => {
    if (!sale) return;
    setReason("");
    setLines(
      sale.items.map((i) => ({
        productId: i.product,
        name: i.name_snapshot,
        sku: i.sku_snapshot,
        quantity: String(i.quantity),
        unitPrice: minorToInput(i.unit_price_snapshot, currency),
      })),
    );
    setPayments(
      sale.payments.map((p) => ({
        method: p.method,
        amount: minorToInput(p.amount, currency),
      })),
    );
    setCustomerId(sale.customer ?? "none");
    setDiscount(minorToInput(sale.discount, currency));
    setTax(minorToInput(sale.tax, currency));
    setSaleDate(isoDay(sale.occurred_at));
    setProductQuery("");
  }, [sale, currency]);

  const parsedLines = useMemo(
    () =>
      lines.map((l) => ({
        ...l,
        qty: Math.max(0, Math.floor(Number(l.quantity) || 0)),
        price: parseMoney(l.unitPrice || "0", currency) || 0,
      })),
    [lines, currency],
  );

  // What may be added to this sale, mirroring the server's rule exactly: any
  // active product, plus anything that was already on the sale when it was
  // opened — a product discontinued since then must still be re-addable, or
  // removing its line by accident would be a one-way door.
  const originalProductIds = useMemo(
    () => new Set((sale?.items ?? []).map((i) => i.product)),
    [sale],
  );
  const addable = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    return (products.data ?? [])
      .filter((p) => p.status === "active" || originalProductIds.has(p.id))
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [products.data, productQuery, originalProductIds]);

  /** Add a product, or bump the quantity if it is already on the sale — two
   *  lines for one product would only confuse the amendment history. */
  function addProduct(product: Product) {
    setLines((prev) => {
      const at = prev.findIndex((l) => l.productId === product.id);
      if (at >= 0) {
        return prev.map((l, i) =>
          i === at ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          quantity: "1",
          unitPrice: minorToInput(product.selling_price, currency),
        },
      ];
    });
    setProductQuery("");
  }

  const subtotal = parsedLines.reduce((sum, l) => sum + l.qty * l.price, 0);
  const discountMinor = parseMoney(discount || "0", currency) || 0;
  const taxMinor = parseMoney(tax || "0", currency) || 0;
  const total = subtotal - discountMinor + taxMinor;
  const paid = payments.reduce((sum, p) => sum + (parseMoney(p.amount, currency) || 0), 0);
  const shortfall = total - paid;
  const onCredit = customerId !== "none";

  if (!sale) return null;

  const emptyLines = parsedLines.some((l) => l.qty <= 0);
  const blockingError = !reason.trim()
    ? "Say why this sale is being corrected."
    : parsedLines.length === 0
      ? "A sale must keep at least one item. If nothing was sold, cancel and void the sale instead."
      : emptyLines
        ? "Every line needs a quantity of at least 1. Remove the line instead."
        : total < 0
          ? "The total cannot be negative."
          : shortfall > 0 && !onCredit
            ? "Payments do not cover the total. Attach a customer to leave the rest on credit."
            : null;

  const payload = buildEditPayload(sale, {
    reason,
    lines: parsedLines.map((l) => ({
      productId: l.productId,
      quantity: l.qty,
      unitPrice: l.price,
    })),
    payments: payments.map((p) => ({
      method: p.method,
      amount: parseMoney(p.amount, currency) || 0,
    })),
    customerId: customerId === "none" ? null : customerId,
    discount: discountMinor,
    tax: taxMinor,
    saleDate,
  });
  const changedFields = changeCount(payload);

  async function handleSave() {
    try {
      await editSale.mutateAsync({ id: sale!.id, ...payload });
      toast.success("Sale corrected");
      onOpenChange(false);
    } catch (err) {
      const short = stockShortages(err);
      if (short) {
        const detail = Object.values(short)
          .map((sh) => `${sh.name}: only ${sh.available} left`)
          .join("; ");
        toast.error(`Not enough stock to increase this sale — ${detail}.`);
        return;
      }
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail ?? "Could not save the correction.");
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Correct this sale</DialogTitle>
          <DialogDescription>
            For a sale that happened but was recorded wrong. The change is permanent and kept in
            this sale&apos;s history with your reason. If the sale never happened at all, void it
            instead.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Reason first — it is the point of the whole screen. */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-reason">Reason for the correction</Label>
            <Input
              id="edit-reason"
              autoFocus
              placeholder="e.g. Rang up 3 by mistake, only 2 were sold"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {/* Lines */}
          <div className="space-y-2">
            <Label>Items</Label>
            {lines.map((line, i) => (
              <div key={`${line.productId}-${i}`} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{line.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{line.sku}</p>
                </div>
                <div className="w-16 space-y-1">
                  <span className="text-[11px] text-muted-foreground">Qty</span>
                  <Input
                    inputMode="numeric"
                    className="h-8"
                    aria-label={`Quantity of ${line.name}`}
                    value={line.quantity}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, idx) => (idx === i ? { ...l, quantity: e.target.value } : l)),
                      )
                    }
                  />
                </div>
                <div className="w-24 space-y-1">
                  <span className="text-[11px] text-muted-foreground">Unit price</span>
                  <Input
                    inputMode="decimal"
                    className="h-8"
                    aria-label={`Unit price of ${line.name}`}
                    value={line.unitPrice}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, idx) => (idx === i ? { ...l, unitPrice: e.target.value } : l)),
                      )
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${line.name}`}
                  onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {lines.length === 0 && (
              <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                No items left. Add what was actually sold, or cancel and void the sale if nothing
                was.
              </p>
            )}

            {/* Adding a line is as necessary as removing one: the common
                correction is "the wrong product was scanned", which needs both
                halves. Without it, removing a line is a one-way door. */}
            <div className="space-y-1.5 rounded-md border p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-8"
                  placeholder="Add an item — search by name, SKU or barcode"
                  aria-label="Search products to add to this sale"
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                />
              </div>

              {products.isLoading ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">Loading products…</p>
              ) : addable.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  {productQuery.trim() ? "No products match that search." : "No products found."}
                </p>
              ) : (
                <ul className="max-h-44 space-y-0.5 overflow-y-auto">
                  {addable.map((product) => {
                    const out = product.stock_cached <= 0;
                    return (
                      <li key={product.id}>
                        <button
                          type="button"
                          onClick={() => addProduct(product)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{product.name}</span>
                            <span className="block font-mono text-[11px] text-muted-foreground">
                              {product.sku}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block font-mono text-xs tabular-nums">
                              {formatMoney(product.selling_price, currency)}
                            </span>
                            <span
                              className={
                                "block text-[11px] tabular-nums " +
                                (out ? "text-destructive" : "text-muted-foreground")
                              }
                            >
                              {out ? "out of stock" : `${product.stock_cached} in stock`}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Stock moves by the difference only: raise a quantity and those units come off the
              shelf now, lower it and they go back.
            </p>
          </div>

          {/* Header fields */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-discount">Discount ({currency})</Label>
              <Input
                id="edit-discount"
                inputMode="decimal"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-tax">Tax ({currency})</Label>
              <Input
                id="edit-tax"
                inputMode="decimal"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-customer">Customer</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger id="edit-customer">
                  <SelectValue placeholder="Walk-in" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Walk-in customer</SelectItem>
                  {(customers.data?.results ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-date">Sale date</Label>
              <EthiopianDatePicker
                id="edit-date"
                value={saleDate}
                onChange={setSaleDate}
                min={dateWindow?.earliest}
                max={dateWindow?.latest}
                ariaLabel="Day this sale counts towards"
              />
            </div>
          </div>

          {/* Payments */}
          <div className="space-y-2">
            <Label>Payments</Label>
            {payments.map((p, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="w-36">
                  <Select
                    value={p.method}
                    onValueChange={(v) =>
                      setPayments((prev) =>
                        prev.map((row, idx) =>
                          idx === i ? { ...row, method: v as PaymentMethod } : row,
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METHODS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  inputMode="decimal"
                  className="h-8 flex-1"
                  aria-label={`Payment amount ${i + 1}`}
                  value={p.amount}
                  onChange={(e) =>
                    setPayments((prev) =>
                      prev.map((row, idx) =>
                        idx === i ? { ...row, amount: e.target.value } : row,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove payment ${i + 1}`}
                  onClick={() => setPayments((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPayments((prev) => [...prev, { method: "cash", amount: "0" }])}
            >
              <Plus className="h-4 w-4" /> Add payment
            </Button>
          </div>

          {/* Totals — recomputed here exactly as the server will recompute them. */}
          <div className="space-y-1 rounded-md bg-muted/50 px-3 py-2 text-sm">
            <Row label="Subtotal" value={formatMoney(subtotal, currency)} />
            {discountMinor > 0 && (
              <Row label="Discount" value={`−${formatMoney(discountMinor, currency)}`} />
            )}
            {taxMinor > 0 && <Row label="Tax" value={formatMoney(taxMinor, currency)} />}
            <div className="flex justify-between pt-1 font-semibold text-foreground">
              <span>New total</span>
              <span className="font-mono tabular-nums">
                {formatMoney(total, currency)}
                {total !== sale.total && (
                  <span className="ml-2 font-normal text-muted-foreground line-through">
                    {formatMoney(sale.total, currency)}
                  </span>
                )}
              </span>
            </div>
            <Row label="Paid" value={formatMoney(paid, currency)} />
            {shortfall > 0 && (
              <Row
                label={onCredit ? "On credit" : "Unpaid"}
                value={formatMoney(shortfall, currency)}
              />
            )}
            {shortfall < 0 && <Row label="Change" value={formatMoney(-shortfall, currency)} />}
          </div>

          {blockingError && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{blockingError}</span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={Boolean(blockingError) || changedFields === 0 || editSale.isPending}
            onClick={handleSave}
          >
            {editSale.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {changedFields === 0 ? "No changes yet" : "Save correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}
