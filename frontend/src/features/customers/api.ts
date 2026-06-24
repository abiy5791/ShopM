import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { Customer, CustomerLedger, Paginated, PaymentMethod } from "@/types";

export function useCustomers(search = "", page = 1) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["customers", activeShopId, search, page],
    enabled: Boolean(activeShopId),
    queryFn: async () =>
      (
        await api.get<Paginated<Customer>>("/customers", {
          params: { search: search || undefined, page, ordering: "name" },
        })
      ).data,
  });
}

export interface CustomerInput {
  name: string;
  phone: string;
  address: string;
  notes: string;
}

export function useSaveCustomer(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CustomerInput) =>
      id
        ? (await api.patch<Customer>(`/customers/${id}`, input)).data
        : (await api.post<Customer>("/customers", input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useCustomerLedger(id: string | null) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["customer-ledger", activeShopId, id],
    enabled: Boolean(activeShopId && id),
    queryFn: async () => (await api.get<CustomerLedger>(`/customers/${id}/ledger`)).data,
  });
}

export function useSettlePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { customer: string; method: PaymentMethod; amount: number }) =>
      (await api.post<{ payment_id: string; balance: number }>("/payments", input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customer-ledger"] });
    },
  });
}
