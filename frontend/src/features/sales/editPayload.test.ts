import { describe, expect, it } from "vitest";

import type { Sale } from "@/types";

import { buildEditPayload, changeCount, isoDay, type SaleEditForm } from "./editPayload";

/** A sale of 3 × Widget at 10.00, paid 30.00 cash, walk-in, no discount or tax. */
function makeSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: "sale-1",
    client_uuid: "uuid-1",
    cashier: "user-1",
    cashier_email: "owner@shop.local",
    customer: null,
    customer_name: null,
    subtotal: 3000,
    discount: 0,
    tax: 0,
    total: 3000,
    status: "completed",
    notes: "",
    amount_paid: 3000,
    change: 0,
    items: [
      {
        id: "item-1",
        product: "product-1",
        name_snapshot: "Widget",
        sku_snapshot: "SKU-1",
        unit_price_snapshot: 1000,
        quantity: 3,
        line_total: 3000,
      },
    ],
    payments: [
      { id: "pay-1", method: "cash", amount: 3000, received_at: "2026-08-19T10:00:00+03:00" },
    ],
    voided_at: null,
    occurred_at: "2026-08-19T10:00:00+03:00",
    is_backdated: false,
    amended_at: null,
    is_amended: false,
    amendments: [],
    created_at: "2026-08-19T10:00:00+03:00",
    ...overrides,
  };
}

/** The form seeded from `sale` with nothing touched. */
function untouchedForm(sale: Sale): SaleEditForm {
  return {
    reason: "Miscounted",
    lines: sale.items.map((i) => ({
      productId: i.product,
      quantity: i.quantity,
      unitPrice: i.unit_price_snapshot,
    })),
    payments: sale.payments.map((p) => ({ method: p.method, amount: p.amount })),
    customerId: sale.customer,
    discount: sale.discount,
    tax: sale.tax,
    saleDate: isoDay(sale.occurred_at),
  };
}

describe("isoDay", () => {
  it("reads the local calendar day, not the UTC one", () => {
    // 23:30 in Addis (UTC+3) is still the 19th locally but the 19th 20:30 UTC.
    // Parsed with its offset and rendered locally, the day must not slip.
    const iso = isoDay("2026-08-19T23:30:00+03:00");
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(iso).toBe(
      new Date("2026-08-19T23:30:00+03:00").toLocaleDateString("sv-SE"), // sv-SE is YYYY-MM-DD
    );
  });
});

describe("buildEditPayload", () => {
  it("sends only the reason when nothing was touched", () => {
    const sale = makeSale();
    const payload = buildEditPayload(sale, untouchedForm(sale));
    expect(payload).toEqual({ reason: "Miscounted" });
    expect(changeCount(payload)).toBe(0);
  });

  it("trims the reason", () => {
    const sale = makeSale();
    const payload = buildEditPayload(sale, { ...untouchedForm(sale), reason: "  Typo  " });
    expect(payload.reason).toBe("Typo");
  });

  it("sends the whole item list when one quantity changes", () => {
    const sale = makeSale();
    const form = untouchedForm(sale);
    form.lines[0].quantity = 2;

    const payload = buildEditPayload(sale, form);
    expect(payload.items).toEqual([{ product: "product-1", quantity: 2, unit_price: 1000 }]);
    // Untouched fields stay out, so the audit trail names only the real change.
    expect(payload.payments).toBeUndefined();
    expect(payload.discount).toBeUndefined();
    expect(payload.sale_date).toBeUndefined();
    expect(changeCount(payload)).toBe(1);
  });

  it("notices a changed unit price", () => {
    const sale = makeSale();
    const form = untouchedForm(sale);
    form.lines[0].unitPrice = 900;
    expect(buildEditPayload(sale, form).items).toEqual([
      { product: "product-1", quantity: 3, unit_price: 900 },
    ]);
  });

  it("notices an added line", () => {
    // The sale-edit dialog can add items back, so a longer list must be sent.
    const sale = makeSale();
    const form = untouchedForm(sale);
    form.lines.push({ productId: "product-2", quantity: 1, unitPrice: 2000 });

    expect(buildEditPayload(sale, form).items).toEqual([
      { product: "product-1", quantity: 3, unit_price: 1000 },
      { product: "product-2", quantity: 1, unit_price: 2000 },
    ]);
  });

  it("notices a line swapped for a different product", () => {
    // "The wrong product was scanned" — the correction the dialog exists for.
    const sale = makeSale();
    const form = untouchedForm(sale);
    form.lines = [{ productId: "product-2", quantity: 3, unitPrice: 2000 }];

    expect(buildEditPayload(sale, form).items).toEqual([
      { product: "product-2", quantity: 3, unit_price: 2000 },
    ]);
  });

  it("notices a removed line", () => {
    const sale = makeSale();
    const form = untouchedForm(sale);
    form.lines = [];
    expect(buildEditPayload(sale, form).items).toEqual([]);
  });

  it("notices a changed payment method", () => {
    const sale = makeSale();
    const form = untouchedForm(sale);
    form.payments[0].method = "telebirr";

    const payload = buildEditPayload(sale, form);
    expect(payload.payments).toEqual([{ method: "telebirr", amount: 3000 }]);
    expect(payload.items).toBeUndefined();
  });

  it("drops zero-amount payment rows, which are just half-filled fields", () => {
    const sale = makeSale();
    const form = untouchedForm(sale);
    form.payments = [
      { method: "cash", amount: 3000 },
      { method: "telebirr", amount: 0 },
    ];
    expect(buildEditPayload(sale, form).payments).toEqual([{ method: "cash", amount: 3000 }]);
  });

  it("sends the customer when one is attached, and null when detached", () => {
    const walkIn = makeSale();
    const attached = buildEditPayload(walkIn, {
      ...untouchedForm(walkIn),
      customerId: "cust-1",
    });
    expect(attached.customer).toBe("cust-1");

    const credit = makeSale({ customer: "cust-1", customer_name: "Abebe" });
    const detached = buildEditPayload(credit, { ...untouchedForm(credit), customerId: null });
    expect(detached.customer).toBeNull();
    expect(changeCount(detached)).toBe(1);
  });

  it("sends discount and tax only when they move", () => {
    const sale = makeSale({ discount: 100, tax: 50 });
    const unchanged = buildEditPayload(sale, untouchedForm(sale));
    expect(unchanged.discount).toBeUndefined();
    expect(unchanged.tax).toBeUndefined();

    const moved = buildEditPayload(sale, { ...untouchedForm(sale), discount: 0 });
    expect(moved.discount).toBe(0); // zero is a real change, not a missing value
    expect(moved.tax).toBeUndefined();
  });

  it("sends the sale date only when the day actually differs", () => {
    const sale = makeSale();
    const same = buildEditPayload(sale, untouchedForm(sale));
    expect(same.sale_date).toBeUndefined();

    const moved = buildEditPayload(sale, { ...untouchedForm(sale), saleDate: "2026-08-11" });
    expect(moved.sale_date).toBe("2026-08-11");
  });

  it("never sends an empty sale date", () => {
    const sale = makeSale();
    const payload = buildEditPayload(sale, { ...untouchedForm(sale), saleDate: "" });
    expect(payload.sale_date).toBeUndefined();
  });

  it("carries every simultaneous change", () => {
    const sale = makeSale();
    const form = untouchedForm(sale);
    form.lines[0].quantity = 2;
    form.payments = [{ method: "telebirr", amount: 2000 }];
    form.customerId = "cust-1";
    form.discount = 100;
    form.tax = 50;
    form.saleDate = "2026-08-11";

    expect(changeCount(buildEditPayload(sale, form))).toBe(6);
  });
});
