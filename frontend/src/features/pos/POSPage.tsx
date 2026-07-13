import { AlertTriangle, Minus, Plus, ScanLine, Search, Trash2, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import { Skeleton } from "@/components/ui/skeleton";
import { useCustomers } from "@/features/customers/api";
import { useAuthStore } from "@/lib/auth";
import { formatMoney, parseMoney } from "@/lib/money";
import type { PaymentInput, ReceiptData, SalePayload } from "@/types";

import { checkout, stockShortages, usePendingSync, usePosCatalog, useActiveShop } from "./api";
import {
  type AddResult,
  type CartLine,
  cartShortages,
  cartSubtotal,
  cartTax,
  cartTotal,
  useCartStore,
} from "./cartStore";
import { FailedSalesDialog } from "./FailedSalesDialog";
import { PaymentDialog } from "./PaymentDialog";
import { Receipt } from "./Receipt";
import type { Product } from "@/types";

export default function POSPage() {
  const shop = useActiveShop();
  const shopId = useAuthStore((s) => s.activeShopId);
  const user = useAuthStore((s) => s.user);
  const currency = shop?.currency ?? "ETB";
  const taxRate = Number(shop?.tax_rate ?? "0");

  const { products, offline, isLoading } = usePosCatalog();
  const { pending, failed, online, refresh: refreshPendingSync } = usePendingSync();

  const cart = useCartStore();
  const ensureShop = useCartStore((s) => s.ensureShop);
  useEffect(() => {
    ensureShop(shopId);
  }, [shopId, ensureShop]);

  // Keep cart lines' known stock in step with the (auto-refreshing) catalog.
  const syncStock = useCartStore((s) => s.syncStock);
  useEffect(() => {
    if (products.length > 0) syncStock(products);
  }, [products, syncStock]);

  const customers = useCustomers();
  const [customerId, setCustomerId] = useState("none");

  const [query, setQuery] = useState("");
  const [hideOutOfStock, setHideOutOfStock] = useState(false);
  const [discountInput, setDiscountInput] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const discount = parseMoney(discountInput || "0", currency) || 0;
  const subtotal = cartSubtotal(cart.lines);
  const tax = cart.taxEnabled ? cartTax(cart.lines, discount, taxRate) : 0;
  const total = cartTotal(cart.lines, discount, taxRate, cart.taxEnabled);
  const shortages = cartShortages(cart.lines);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = hideOutOfStock ? products.filter((p) => p.stock_cached > 0) : products;
    if (!q) return visible.slice(0, 50);
    return visible
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [products, query, hideOutOfStock]);

  function addToCart(product: Product) {
    const result: AddResult = cart.add(product);
    if (result === "out-of-stock") {
      toast.error(`${product.name} is out of stock.`);
    } else if (result === "at-stock-limit") {
      toast.warning(`Only ${product.stock_cached} of ${product.name} in stock.`);
    }
    return result;
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const q = query.trim().toLowerCase();
    const exact = products.find((p) => p.barcode.toLowerCase() === q || p.sku.toLowerCase() === q);
    if (exact && addToCart(exact) === "added") {
      setQuery("");
    }
  }

  async function handleConfirm(payments: PaymentInput[]) {
    if (!shopId || !shop || !user) return;
    setSubmitting(true);
    const payload: SalePayload = {
      client_uuid: crypto.randomUUID(),
      items: cart.lines.map((l) => ({
        product: l.productId,
        quantity: l.quantity,
        unit_price: l.unitPrice,
      })),
      payments,
      discount,
      tax,
      ...(customerId !== "none" ? { customer: customerId } : {}),
    };
    const amountPaid = payments.reduce((s, p) => s + p.amount, 0);
    const localReceipt: ReceiptData = {
      shop_name: shop.name,
      shop_address: shop.address,
      cashier_name: user.full_name,
      currency,
      created_at: new Date().toISOString(),
      items: cart.lines.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        unit_price: l.unitPrice,
        line_total: l.unitPrice * l.quantity,
      })),
      subtotal,
      discount,
      tax,
      total,
      amount_paid: amountPaid,
      change: Math.max(0, amountPaid - total),
      offline: true,
    };

    try {
      const result = await checkout(payload, localReceipt, {
        shopId,
        shopName: shop.name,
        cashier: user.full_name,
      });
      setReceipt(result.receipt);
      setPayOpen(false);
      cart.clear();
      setDiscountInput("");
      setCustomerId("none");
      if (!result.synced) await refreshPendingSync(); // reflect the new queued sale immediately
      toast.success(result.synced ? "Sale completed" : "Saved offline — will sync when online");
    } catch (err) {
      const short = stockShortages(err);
      if (short) {
        // Update the cart's known stock to the server's authoritative numbers,
        // close the payment dialog, and point the cashier at the lines to fix.
        cart.applyServerStock(
          Object.fromEntries(Object.entries(short).map(([id, s]) => [id, s.available])),
        );
        setPayOpen(false);
        const lines = Object.values(short)
          .map((s) => `${s.name}: only ${s.available} left`)
          .join("; ");
        toast.error(`Not enough stock — ${lines}. Adjust the highlighted items.`);
      } else {
        toast.error("Checkout failed. Please review and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-4 lg:flex-row">
      {/* Catalogue */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              autoFocus
              placeholder="Search or scan barcode, then Enter"
              className="pl-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
            />
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={hideOutOfStock}
              onChange={(e) => setHideOutOfStock(e.target.checked)}
            />
            Hide out of stock
          </label>
          {!online && (
            <Badge variant="destructive" className="gap-1">
              <WifiOff className="h-3 w-3" /> Offline
            </Badge>
          )}
          {pending > 0 && (
            <Badge variant="accent" title="Sales waiting to sync">
              {pending} pending sync
            </Badge>
          )}
          {failed > 0 && (
            <button
              type="button"
              onClick={() => setFailedOpen(true)}
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Sales the server rejected — review them"
            >
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> {failed} failed
              </Badge>
            </button>
          )}
        </div>

        <Card className="flex-1 overflow-y-auto p-2">
          {isLoading && products.length === 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <ScanLine className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No products</p>
              <p className="text-xs text-muted-foreground">
                {offline ? "Showing cached products." : "Try a different search."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {filtered.map((p) => {
                const out = p.stock_cached <= 0;
                const low = !out && p.stock_cached <= p.min_stock_alert;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addToCart(p)}
                    disabled={out}
                    className="flex flex-col rounded-md border bg-card p-2.5 text-left transition-colors hover:border-accent hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-card"
                  >
                    <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
                    <span className="mt-0.5 font-mono text-xs text-muted-foreground">{p.sku}</span>
                    <span className="mt-auto flex items-end justify-between gap-1 pt-1">
                      <span className="font-mono text-sm font-semibold tabular-nums">
                        {formatMoney(p.selling_price, currency)}
                      </span>
                      {out ? (
                        <span className="text-[11px] font-medium text-destructive">
                          Out of stock
                        </span>
                      ) : low ? (
                        <span className="text-[11px] font-medium text-amber-600 dark:text-amber-500">
                          {p.stock_cached} left
                        </span>
                      ) : (
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {p.stock_cached} in stock
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Cart */}
      <Card className="flex w-full flex-col lg:w-[380px]">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <span className="text-sm font-semibold">Current sale</span>
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger className="h-8 w-44">
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

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {cart.lines.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              Tap a product to add it to the sale.
            </p>
          ) : (
            cart.lines.map((line) => (
              <CartRow key={line.productId} line={line} currency={currency} />
            ))
          )}
        </div>

        <div className="space-y-3 border-t px-4 py-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="discount" className="w-20 text-xs">
              Discount
            </Label>
            <Input
              id="discount"
              inputMode="decimal"
              placeholder="0"
              className="h-8"
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
            />
          </div>
          {taxRate > 0 && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={cart.taxEnabled}
                onChange={(e) => cart.setTaxEnabled(e.target.checked)}
              />
              Apply {taxRate}% tax
            </label>
          )}

          <div className="space-y-1 text-sm">
            <Row label="Subtotal" value={formatMoney(subtotal, currency)} />
            {discount > 0 && <Row label="Discount" value={`−${formatMoney(discount, currency)}`} />}
            {tax > 0 && <Row label="Tax" value={formatMoney(tax, currency)} />}
            <div className="flex justify-between pt-1 text-base font-semibold">
              <span>Total</span>
              <span className="font-mono tabular-nums">{formatMoney(total, currency)}</span>
            </div>
          </div>

          {shortages.length > 0 && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Not enough stock for{" "}
                {shortages.map((l) => `${l.name} (${l.stock} left)`).join(", ")}. Lower the quantity
                to continue.
              </span>
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={cart.lines.length === 0}
              onClick={() => cart.clear()}
            >
              Clear
            </Button>
            <Button
              className="flex-1"
              disabled={cart.lines.length === 0 || total < 0 || shortages.length > 0}
              onClick={() => setPayOpen(true)}
            >
              Charge
            </Button>
          </div>
        </div>
      </Card>

      <PaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        total={total}
        currency={currency}
        submitting={submitting}
        allowCredit={customerId !== "none"}
        onConfirm={handleConfirm}
      />

      <FailedSalesDialog
        open={failedOpen}
        onOpenChange={setFailedOpen}
        currency={currency}
        onChanged={refreshPendingSync}
      />

      <Dialog open={Boolean(receipt)} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader className="no-print">
            <DialogTitle>Receipt</DialogTitle>
          </DialogHeader>
          {receipt && <Receipt data={receipt} />}
          <DialogFooter className="no-print">
            <Button variant="outline" onClick={() => setReceipt(null)}>
              Done
            </Button>
            <Button onClick={() => window.print()}>Print</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CartRow({ line, currency }: { line: CartLine; currency: string }) {
  const setQty = useCartStore((s) => s.setQty);
  const remove = useCartStore((s) => s.remove);
  const over = line.quantity > line.stock;
  const atLimit = line.quantity >= line.stock;
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{line.name}</p>
        <p className="font-mono text-xs text-muted-foreground">
          {formatMoney(line.unitPrice, currency)} each
        </p>
        {over && <p className="text-xs font-medium text-destructive">Only {line.stock} in stock</p>}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          aria-label={`Remove one ${line.name}`}
          onClick={() => setQty(line.productId, line.quantity - 1)}
        >
          <Minus className="h-3 w-3" />
        </Button>
        <span
          className={`w-7 text-center font-mono text-sm tabular-nums ${over ? "text-destructive" : ""}`}
        >
          {line.quantity}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          aria-label={`Add one ${line.name}`}
          disabled={atLimit}
          title={atLimit ? `Only ${line.stock} in stock` : undefined}
          onClick={() => setQty(line.productId, line.quantity + 1)}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      <div className="w-16 text-right font-mono text-sm tabular-nums">
        {formatMoney(line.unitPrice * line.quantity, currency)}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground"
        onClick={() => remove(line.productId)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
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
