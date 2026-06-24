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

export function useCreatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PurchaseInput) =>
      (await api.post<Purchase>("/purchases", input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["products"] }); // stock changed
    },
  });
}
