import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type {
  AdjustmentType,
  Category,
  InventoryTransaction,
  Paginated,
  Product,
  Shop,
  Supplier,
} from "@/types";

export interface ProductListParams {
  search?: string;
  status?: string;
  lowStock?: boolean;
  page?: number;
}

export function useProducts(params: ProductListParams) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["products", activeShopId, params],
    enabled: Boolean(activeShopId),
    queryFn: async () => {
      const res = await api.get<Paginated<Product>>("/products", {
        params: {
          search: params.search || undefined,
          status: params.status || undefined,
          low_stock: params.lowStock ? "true" : undefined,
          page: params.page,
          ordering: "name",
        },
      });
      return res.data;
    },
  });
}

export function useCategories() {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["categories", activeShopId],
    enabled: Boolean(activeShopId),
    queryFn: async () => (await api.get<Paginated<Category>>("/categories")).data.results,
  });
}

export function useSuppliers() {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["suppliers", activeShopId],
    enabled: Boolean(activeShopId),
    queryFn: async () => (await api.get<Paginated<Supplier>>("/suppliers")).data.results,
  });
}

/** Active shop's currency, readable by any member (from /shops). */
export function useActiveCurrency(): string {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  const { data } = useQuery({
    queryKey: ["shops"],
    queryFn: async () => (await api.get<Paginated<Shop>>("/shops")).data.results,
    staleTime: 5 * 60 * 1000,
  });
  return data?.find((s) => s.id === activeShopId)?.currency ?? "USD";
}

export interface ProductInput {
  name: string;
  sku: string;
  barcode: string;
  category: string | null;
  supplier: string | null;
  purchase_price: number;
  selling_price: number;
  unit: string;
  min_stock_alert: number;
  status: "active" | "inactive";
}

function useInvalidateProducts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["products"] });
}

export function useSaveProduct(id?: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: async (input: ProductInput) => {
      const res = id
        ? await api.patch<Product>(`/products/${id}`, input)
        : await api.post<Product>("/products", input);
      return res.data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/products/${id}`),
    onSuccess: invalidate,
  });
}

export interface AdjustInput {
  product: string;
  quantity: number;
  type: AdjustmentType;
  notes?: string;
}

export function useAdjustStock() {
  const invalidate = useInvalidateProducts();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AdjustInput) =>
      (await api.post<InventoryTransaction>("/inventory/adjust", input)).data,
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["inventory-transactions"] });
    },
  });
}

export function useProductTransactions(productId: string | null) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["inventory-transactions", activeShopId, productId],
    enabled: Boolean(activeShopId && productId),
    queryFn: async () => {
      const res = await api.get<Paginated<InventoryTransaction>>("/inventory/transactions", {
        params: { product: productId, ordering: "-created_at" },
      });
      return res.data.results;
    },
  });
}
