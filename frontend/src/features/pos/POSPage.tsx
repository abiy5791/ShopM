import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  Minus,
  Plus,
  ScanLine,
  Search,
  ShoppingCart,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
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
  type CartState,
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
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const discount = parseMoney(discountInput || "0", currency) || 0;
  const subtotal = cartSubtotal(cart.lines);
  const tax = cart.taxEnabled ? cartTax(cart.lines, discount, taxRate) : 0;
  const total = cartTotal(cart.lines, discount, taxRate, cart.taxEnabled);
  const shortages = cartShortages(cart.lines);
  const itemCount = cart.lines.reduce((n, l) => n + l.quantity, 0);

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
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-7rem)] lg:flex-row">
      {/* Catalogue. Extra bottom padding on mobile clears the fixed cart bar. */}
      <div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-0">
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

      {/* Cart — a side panel from lg up; on phones/tablets it lives in a
          bottom-sheet reached from the sticky bar below (POS is thumb-driven). */}
      <Card className="hidden w-full flex-col overflow-hidden lg:flex lg:w-[380px]">
        <SaleCart
          cart={cart}
          currency={currency}
          taxRate={taxRate}
          customers={customers.data?.results ?? []}
          customerId={customerId}
          setCustomerId={setCustomerId}
          discountInput={discountInput}
          setDiscountInput={setDiscountInput}
          discount={discount}
          subtotal={subtotal}
          tax={tax}
          total={total}
          shortages={shortages}
          onCharge={() => setPayOpen(true)}
        />
      </Card>

      {/* Mobile: sticky bar that summarises the sale and opens the sheet. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 p-3 backdrop-blur md:left-60 lg:hidden">
        <Button
          className="h-11 w-full justify-between"
          disabled={cart.lines.length === 0}
          onClick={() => setCartOpen(true)}
        >
          <span className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            {cart.lines.length
              ? `${itemCount} item${itemCount === 1 ? "" : "s"} in sale`
              : "No items yet"}
          </span>
          {cart.lines.length > 0 && (
            <span className="font-mono tabular-nums">{formatMoney(total, currency)}</span>
          )}
        </Button>
      </div>

      {/* Mobile: the current sale as a bottom-sheet. */}
      <DialogPrimitive.Root open={cartOpen} onOpenChange={setCartOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-2xl border bg-card shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom lg:hidden"
          >
            <DialogPrimitive.Title className="sr-only">Current sale</DialogPrimitive.Title>
            <div className="mx-auto mb-1 mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border" />
            <SaleCart
              cart={cart}
              currency={currency}
              taxRate={taxRate}
              customers={customers.data?.results ?? []}
              customerId={customerId}
              setCustomerId={setCustomerId}
              discountInput={discountInput}
              setDiscountInput={setDiscountInput}
              discount={discount}
              subtotal={subtotal}
              tax={tax}
              total={total}
              shortages={shortages}
              onCharge={() => {
                setCartOpen(false);
                setPayOpen(true);
              }}
              onClose={() => setCartOpen(false)}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

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

/** The current-sale body — customer, line items, discount/tax, totals and the
 *  Clear/Charge actions. Rendered in the desktop side panel and in the mobile
 *  bottom-sheet; it's a flex column so the line list scrolls while the header
 *  and totals stay put. `onClose` (mobile only) adds a close control. */
function SaleCart({
  cart,
  currency,
  taxRate,
  customers,
  customerId,
  setCustomerId,
  discountInput,
  setDiscountInput,
  discount,
  subtotal,
  tax,
  total,
  shortages,
  onCharge,
  onClose,
}: {
  cart: CartState;
  currency: string;
  taxRate: number;
  customers: { id: string; name: string }[];
  customerId: string;
  setCustomerId: (value: string) => void;
  discountInput: string;
  setDiscountInput: (value: string) => void;
  discount: number;
  subtotal: number;
  tax: number;
  total: number;
  shortages: CartLine[];
  onCharge: () => void;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <span className="text-sm font-semibold">Current sale</span>
        <div className="flex items-center gap-1">
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger className="h-8 w-40 sm:w-44">
              <SelectValue placeholder="Walk-in" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Walk-in customer</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground lg:hidden"
              onClick={onClose}
              aria-label="Close current sale"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
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
        <label className="flex items-center gap-2">
          <span className="w-20 text-xs">Discount</span>
          <Input
            inputMode="decimal"
            placeholder="0"
            className="h-8"
            value={discountInput}
            onChange={(e) => setDiscountInput(e.target.value)}
          />
        </label>
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
              {shortages.map((l) => `${l.name} (${l.stock} left)`).join(", ")}. Lower the quantity to
              continue.
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
            onClick={onCharge}
          >
            Charge
          </Button>
        </div>
      </div>
    </>
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
      <div className="w-20 shrink-0 pl-1 text-right font-mono text-sm tabular-nums">
        {formatMoney(line.unitPrice * line.quantity, currency)}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground"
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
