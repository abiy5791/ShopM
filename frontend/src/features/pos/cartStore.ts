import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Product } from "@/types";

export interface CartLine {
  productId: string;
  name: string;
  sku: string;
  unitPrice: number; // integer minor units, snapshot at add time
  quantity: number;
  stock: number; // best-effort, for UI warnings only
}

interface CartState {
  shopId: string | null;
  lines: CartLine[];
  discount: number; // minor units
  taxEnabled: boolean;

  /** Reset the cart if the active shop changed (carts are per-shop). */
  ensureShop: (shopId: string | null) => void;
  add: (product: Product) => void;
  setQty: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  setDiscount: (minor: number) => void;
  setTaxEnabled: (enabled: boolean) => void;
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
          existing.quantity += 1;
        } else {
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
      },

      setQty: (productId, quantity) => {
        if (quantity <= 0) {
          set({ lines: get().lines.filter((l) => l.productId !== productId) });
          return;
        }
        set({
          lines: get().lines.map((l) => (l.productId === productId ? { ...l, quantity } : l)),
        });
      },

      remove: (productId) => set({ lines: get().lines.filter((l) => l.productId !== productId) }),
      setDiscount: (minor) => set({ discount: Math.max(0, minor) }),
      setTaxEnabled: (enabled) => set({ taxEnabled: enabled }),
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
