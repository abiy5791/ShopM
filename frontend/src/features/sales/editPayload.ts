import type { PaymentMethod, Sale, SaleEditPayload } from "@/types";

/** Gregorian ISO ("YYYY-MM-DD") of a timestamp, read as a LOCAL date. Never
 *  `toISOString()` — that is UTC, so an evening sale in Addis (UTC+3) would
 *  report the next day and look like a date change that never happened. */
export function isoDay(timestamp: string): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The edit form's values, already parsed into the same units the API uses. */
export interface SaleEditForm {
  reason: string;
  lines: { productId: string; quantity: number; unitPrice: number }[];
  payments: { method: PaymentMethod; amount: number }[];
  /** null = walk-in. */
  customerId: string | null;
  discount: number;
  tax: number;
  /** Gregorian ISO day, "" when untouched. */
  saleDate: string;
}

/**
 * Build the PATCH body for a sale correction, carrying **only what actually
 * changed**.
 *
 * This matters beyond saving bytes: the server records every submitted field in
 * the sale's permanent amendment history, so sending the whole sale back would
 * turn "quantity 3 → 2" into a diff of everything and make the audit trail
 * useless. Equally, dropping a field the owner did change would silently lose
 * their correction — so both directions are covered by tests.
 *
 * `items` and `payments` are all-or-nothing: the server replaces the whole list,
 * because a partial edit of a money list has no unambiguous meaning.
 */
export function buildEditPayload(sale: Sale, form: SaleEditForm): SaleEditPayload {
  const payload: SaleEditPayload = { reason: form.reason.trim() };

  const itemsChanged =
    form.lines.length !== sale.items.length ||
    form.lines.some((line, i) => {
      const original = sale.items[i];
      return (
        original.product !== line.productId ||
        original.quantity !== line.quantity ||
        original.unit_price_snapshot !== line.unitPrice
      );
    });
  if (itemsChanged) {
    payload.items = form.lines.map((line) => ({
      product: line.productId,
      quantity: line.quantity,
      unit_price: line.unitPrice,
    }));
  }

  const paymentsChanged =
    form.payments.length !== sale.payments.length ||
    form.payments.some((p, i) => {
      const original = sale.payments[i];
      return original.method !== p.method || original.amount !== p.amount;
    });
  if (paymentsChanged) {
    // A zero-amount row is a half-filled form field, not a payment.
    payload.payments = form.payments.filter((p) => p.amount > 0);
  }

  if (form.customerId !== (sale.customer ?? null)) payload.customer = form.customerId;
  if (form.discount !== sale.discount) payload.discount = form.discount;
  if (form.tax !== sale.tax) payload.tax = form.tax;
  if (form.saleDate && form.saleDate !== isoDay(sale.occurred_at)) {
    payload.sale_date = form.saleDate;
  }
  return payload;
}

/** How many real changes the payload carries (the reason is not a change). */
export function changeCount(payload: SaleEditPayload): number {
  return Object.keys(payload).filter((key) => key !== "reason").length;
}
