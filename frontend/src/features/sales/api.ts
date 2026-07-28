import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { Paginated, ReceiptData, Sale, SaleItem, SalePayment } from "@/types";

export function useSales(page = 1) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["sales", activeShopId, page],
    enabled: Boolean(activeShopId),
    queryFn: async () =>
      (await api.get<Paginated<Sale>>("/sales", { params: { page, ordering: "-created_at" } }))
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
        created_at: data.created_at,
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
