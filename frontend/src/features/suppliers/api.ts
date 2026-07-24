import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { Paginated, Supplier } from "@/types";

export function useSuppliersList(search = "", page = 1) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["suppliers", activeShopId, search, page],
    enabled: Boolean(activeShopId),
    queryFn: async () =>
      (
        await api.get<Paginated<Supplier>>("/suppliers", {
          params: { search: search || undefined, page, ordering: "name" },
        })
      ).data,
  });
}

export interface SupplierInput {
  name: string;
  phone: string;
  address: string;
  notes: string;
}

export function useSaveSupplier(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SupplierInput) =>
      id
        ? (await api.patch<Supplier>(`/suppliers/${id}`, input)).data
        : (await api.post<Supplier>("/suppliers", input)).data,
    // Prefix match also refreshes the product form's supplier dropdown.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}
