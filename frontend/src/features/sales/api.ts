import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { Paginated, ReceiptData, Sale, SaleEditPayload, SaleItem, SalePayment } from "@/types";

export function useSales(page = 1) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["sales", activeShopId, page],
    enabled: Boolean(activeShopId),
    queryFn: async () =>
      (await api.get<Paginated<Sale>>("/sales", { params: { page, ordering: "-occurred_at" } }))
        .data,
  });
}

/** Fetch one full sale by id (line items, payments, totals) for the detail view. */
export function useSale(saleId: string | null) {
  return useQuery({
    queryKey: ["sale", saleId],
    enabled: Boolean(saleId),
    queryFn: async () => (await api.get<Sale>(`/sales/${saleId}`)).data,
  });
}

/** Shape of GET /sales/{id}/receipt (backend ReceiptSerializer). */
interface ServerReceipt {
  shop_name: string;
  shop_address: string;
  cashier_name: string;
  currency: string;
  receipt_footer: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amount_paid: number;
  change: number;
  items: SaleItem[];
  payments: SalePayment[];
  occurred_at: string;
  is_backdated: boolean;
  created_at: string;
}

/** Fetch a past sale's printable receipt (for reprinting from the detail view). */
export function useSaleReceipt(saleId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["sale-receipt", saleId],
    enabled: Boolean(saleId) && enabled,
    queryFn: async (): Promise<ReceiptData> => {
      const { data } = await api.get<ServerReceipt>(`/sales/${saleId}/receipt`);
      return {
        shop_name: data.shop_name,
        shop_address: data.shop_address,
        cashier_name: data.cashier_name,
        currency: data.currency,
        receipt_footer: data.receipt_footer,
        // A reprint shows the day the sale is booked to, not the day entered.
        created_at: data.occurred_at,
        is_backdated: data.is_backdated,
        items: data.items.map((i) => ({
          name: i.name_snapshot,
          quantity: i.quantity,
          unit_price: i.unit_price_snapshot,
          line_total: i.line_total,
        })),
        subtotal: data.subtotal,
        discount: data.discount,
        tax: data.tax,
        total: data.total,
        amount_paid: data.amount_paid,
        change: data.change,
        offline: false,
      };
    },
  });
}

/**
 * Correct a mis-recorded sale. Owner-only server-side, and a reason is always
 * required. The server recomputes the totals, moves stock by the net
 * difference, and keeps the before/after in the sale's amendment history.
 */
export function useEditSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: SaleEditPayload & { id: string }) =>
      (await api.patch<Sale>(`/sales/${id}`, payload)).data,
    onSuccess: (sale) => {
      // An edit can move money, stock, credit and the day it all lands on.
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["sale-receipt", sale.id] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["day-book"] });
    },
  });
}

export function useVoidSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<Sale>(`/sales/${id}/void`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["products"] }); // stock restored
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
