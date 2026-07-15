import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Product } from "@/types";

export interface CartLine {
  productId: string;
  name: string;
  sku: string;
  unitPrice: number; // integer minor units, snapshot at add time
  quantity: number;
  stock: number; // last-known available stock; the server re-checks at checkout
}

/** Outcome of trying to add a product, so the POS can explain refusals. */
export type AddResult = "added" | "out-of-stock" | "at-stock-limit";

export interface CartState {
  shopId: string | null;
  lines: CartLine[];
  discount: number; // minor units
  taxEnabled: boolean;

  /** Reset the cart if the active shop changed (carts are per-shop). */
  ensureShop: (shopId: string | null) => void;
  /** Add one unit, refusing to exceed the product's available stock. */
  add: (product: Product) => AddResult;
  /** Set a line's quantity, clamped to [1, stock]; <= 0 removes the line. */
  setQty: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  setDiscount: (minor: number) => void;
  setTaxEnabled: (enabled: boolean) => void;
  /** Refresh each line's known stock from a fresh catalog fetch. */
  syncStock: (products: Product[]) => void;
  /** Apply authoritative availability from a server insufficient_stock reply. */
  applyServerStock: (available: Record<string, number>) => void;
  clear: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      shopId: null,
      lines: [],
      discount: 0,
      taxEnabled: false,

      ensureShop: (shopId) => {
        if (get().shopId !== shopId) {
          set({ shopId, lines: [], discount: 0, taxEnabled: false });
        }
      },

      add: (product) => {
        const lines = [...get().lines];
        const existing = lines.find((l) => l.productId === product.id);
        if (existing) {
          // The catalog row is fresher than the cart line — trust its stock.
          existing.stock = product.stock_cached;
          if (existing.quantity + 1 > existing.stock) {
            set({ lines });
            return "at-stock-limit";
          }
          existing.quantity += 1;
        } else {
          if (product.stock_cached <= 0) return "out-of-stock";
          lines.push({
            productId: product.id,
            name: product.name,
            sku: product.sku,
            unitPrice: product.selling_price,
            quantity: 1,
            stock: product.stock_cached,
          });
        }
        set({ lines });
        return "added";
      },

      setQty: (productId, quantity) => {
        if (quantity <= 0) {
          set({ lines: get().lines.filter((l) => l.productId !== productId) });
          return;
        }
        set({
          lines: get().lines.map((l) =>
            l.productId === productId ? { ...l, quantity: Math.min(quantity, l.stock) } : l,
          ),
        });
      },

      remove: (productId) => set({ lines: get().lines.filter((l) => l.productId !== productId) }),
      setDiscount: (minor) => set({ discount: Math.max(0, minor) }),
      setTaxEnabled: (enabled) => set({ taxEnabled: enabled }),

      syncStock: (products) => {
        const stockById = new Map(products.map((p) => [p.id, p.stock_cached]));
        const lines = get().lines.map((l) => {
          const stock = stockById.get(l.productId);
          return stock === undefined || stock === l.stock ? l : { ...l, stock };
        });
        set({ lines });
      },

      applyServerStock: (available) => {
        set({
          lines: get().lines.map((l) =>
            available[l.productId] === undefined ? l : { ...l, stock: available[l.productId] },
          ),
        });
      },

      clear: () => set({ lines: [], discount: 0, taxEnabled: false }),
    }),
    { name: "shopm-cart" },
  ),
);

// ---- derived helpers (no business math beyond display; mirrors the server) ----
export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
}

export function cartTax(lines: CartLine[], discount: number, taxRatePercent: number): number {
  const base = Math.max(0, cartSubtotal(lines) - discount);
  return Math.round((base * taxRatePercent) / 100);
}

export function cartTotal(
  lines: CartLine[],
  discount: number,
  taxRatePercent: number,
  taxEnabled: boolean,
): number {
  const tax = taxEnabled ? cartTax(lines, discount, taxRatePercent) : 0;
  return Math.max(0, cartSubtotal(lines) - discount + tax);
}

/** Lines whose quantity exceeds last-known stock (e.g. stock changed after add). */
export function cartShortages(lines: CartLine[]): CartLine[] {
  return lines.filter((l) => l.quantity > l.stock);
}
