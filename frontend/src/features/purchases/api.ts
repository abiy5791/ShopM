import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { Paginated, Purchase } from "@/types";

export interface PurchaseLineInput {
  product: string;
  quantity: number;
  unit_cost: number;
}

export interface PurchaseInput {
  supplier: string | null;
  items: PurchaseLineInput[];
  amount_paid: number;
  date?: string;
  notes?: string;
}

export function usePurchases(page = 1) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["purchases", activeShopId, page],
    enabled: Boolean(activeShopId),
    queryFn: async () =>
      (await api.get<Paginated<Purchase>>("/purchases", { params: { page } })).data,
  });
}

/** Refresh everything a purchase touches: the list, product stock, and (since
 *  payable is derived) suppliers. */
function invalidatePurchaseData(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["purchases"] });
  qc.invalidateQueries({ queryKey: ["products"] });
  qc.invalidateQueries({ queryKey: ["suppliers"] });
}

export function useCreatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PurchaseInput) =>
      (await api.post<Purchase>("/purchases", input)).data,
    onSuccess: () => invalidatePurchaseData(qc),
  });
}

export function useUpdatePurchase(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PurchaseInput) =>
      (await api.patch<Purchase>(`/purchases/${id}`, input)).data,
    onSuccess: () => invalidatePurchaseData(qc),
  });
}

export function useDeletePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/purchases/${id}`);
    },
    onSuccess: () => invalidatePurchaseData(qc),
  });
}
