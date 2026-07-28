import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { Expense, ExpenseCategory, Paginated } from "@/types";

export function useExpenses(page = 1) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["expenses", activeShopId, page],
    enabled: Boolean(activeShopId),
    queryFn: async () =>
      (await api.get<Paginated<Expense>>("/expenses", { params: { page } })).data,
  });
}

export function useExpenseCategories() {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["expense-categories", activeShopId],
    enabled: Boolean(activeShopId),
    queryFn: async () =>
      (await api.get<Paginated<ExpenseCategory>>("/expense-categories")).data.results,
  });
}

/** Invalidate every view that reads expense figures (list + daily close + dashboard). */
function invalidateExpenseViews(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["expenses"] });
  qc.invalidateQueries({ queryKey: ["day-book"] });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: FormData) => (await api.post<Expense>("/expenses", form)).data,
    onSuccess: () => invalidateExpenseViews(qc),
  });
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: FormData | Record<string, unknown> }) =>
      (await api.patch<Expense>(`/expenses/${id}`, body)).data,
    onSuccess: () => invalidateExpenseViews(qc),
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/expenses/${id}`),
    onSuccess: () => invalidateExpenseViews(qc),
  });
}
