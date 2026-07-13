import { beforeEach, describe, expect, it } from "vitest";

import type { Product } from "@/types";

import { cartShortages, useCartStore } from "./cartStore";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Widget",
    sku: "SKU-1",
    barcode: "",
    category: null,
    category_name: null,
    supplier: null,
    supplier_name: null,
    purchase_price: 500,
    selling_price: 1000,
    unit: "pcs",
    min_stock_alert: 2,
    status: "active",
    stock_cached: 3,
    is_low_stock: false,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("cartStore stock binding", () => {
  beforeEach(() => {
    useCartStore.setState({ shopId: "shop-1", lines: [], discount: 0, taxEnabled: false });
  });

  it("adds an in-stock product", () => {
    expect(useCartStore.getState().add(product())).toBe("added");
    expect(useCartStore.getState().lines[0].quantity).toBe(1);
  });

  it("refuses an out-of-stock product", () => {
    expect(useCartStore.getState().add(product({ stock_cached: 0 }))).toBe("out-of-stock");
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it("refuses to add beyond available stock", () => {
    const p = product({ stock_cached: 2 });
    const store = useCartStore.getState();
    expect(store.add(p)).toBe("added");
    expect(useCartStore.getState().add(p)).toBe("added");
    expect(useCartStore.getState().add(p)).toBe("at-stock-limit");
    expect(useCartStore.getState().lines[0].quantity).toBe(2);
  });

  it("trusts the fresher catalog stock when re-adding", () => {
    const store = useCartStore.getState();
    store.add(product({ stock_cached: 1 }));
    // Stock rose (e.g. a purchase landed) — the same product now reports more.
    expect(useCartStore.getState().add(product({ stock_cached: 5 }))).toBe("added");
    expect(useCartStore.getState().lines[0].quantity).toBe(2);
    expect(useCartStore.getState().lines[0].stock).toBe(5);
  });

  it("clamps setQty to the known stock", () => {
    useCartStore.getState().add(product({ stock_cached: 4 }));
    useCartStore.getState().setQty("p1", 99);
    expect(useCartStore.getState().lines[0].quantity).toBe(4);
  });

  it("removes the line when quantity drops to zero", () => {
    useCartStore.getState().add(product());
    useCartStore.getState().setQty("p1", 0);
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it("syncStock updates lines and cartShortages flags oversold ones", () => {
    useCartStore.getState().add(product({ stock_cached: 3 }));
    useCartStore.getState().setQty("p1", 3);
    // Another till sold 2 units; the refreshed catalog reports 1 left.
    useCartStore.getState().syncStock([product({ stock_cached: 1 })]);
    const lines = useCartStore.getState().lines;
    expect(lines[0].stock).toBe(1);
    expect(cartShortages(lines)).toHaveLength(1);
  });

  it("applyServerStock uses the server's authoritative availability", () => {
    useCartStore.getState().add(product({ stock_cached: 5 }));
    useCartStore.getState().setQty("p1", 5);
    useCartStore.getState().applyServerStock({ p1: 2 });
    const lines = useCartStore.getState().lines;
    expect(lines[0].stock).toBe(2);
    expect(cartShortages(lines)).toHaveLength(1);
  });
});
