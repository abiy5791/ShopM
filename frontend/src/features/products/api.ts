import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { downloadBlob, filenameFrom } from "@/lib/download";
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

/**
 * All products in the active shop for pickers (purchase/sale forms) — a single
 * large page rather than the paginated list, so no item is silently missing.
 */
export function useAllProducts() {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["products", "all", activeShopId],
    enabled: Boolean(activeShopId),
    queryFn: async () =>
      (
        await api.get<Paginated<Product>>("/products", {
          params: { page_size: 200, ordering: "name" },
        })
      ).data.results,
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

/** Create a category on the fly (used when a new category name is typed in the
 *  product form). Returns the new row so the caller can select it. */
export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => (await api.post<Category>("/categories", { name })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

/** Distinct units of measure already used in this shop, for the unit pick-list. */
export function useProductUnits() {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["product-units", activeShopId],
    enabled: Boolean(activeShopId),
    queryFn: async () => (await api.get<string[]>("/products/units")).data,
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
  return data?.find((s) => s.id === activeShopId)?.currency ?? "ETB";
}

export interface ProductInput {
  name: string;
  category: string | null;
  supplier: string | null;
  purchase_price: number;
  selling_price: number;
  unit: string;
  min_stock_alert: number;
  status: "active" | "inactive";
  /** Opening stock, only sent on create — the server posts it to the ledger. */
  initial_stock?: number;
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

/** One row the importer refused, with the sheet row number the user sees in Excel. */
export interface ImportRowError {
  row: number;
  error: string;
}

/** One field an import row would overwrite, in the units the sheet shows. */
export interface ImportChange {
  field: string;
  from: string;
  to: string;
}

/** A sheet row whose SKU already exists, and what importing it would do to that product. */
export interface ImportConflict {
  /** Row number as Excel shows it. */
  row: number;
  sku: string;
  /** Name of the product this row lands on. */
  existing_name: string;
  /** Set when the clash is with an earlier row of the same sheet, not the catalogue. */
  duplicate_of_row: number | null;
  /** Units this row adds to that product's stock. Zero when the row only edits fields. */
  opening_stock: number;
  /** Fields the row rewrites. Empty when the row only adds stock. */
  changes: ImportChange[];
}

/** A sheet row the import would add, as the preview shows it. */
export interface ImportCreation {
  /** Row number as Excel shows it. */
  row: number;
  sku: string;
  name: string;
  category: string;
  supplier: string;
  /** Major units, already formatted for the shop's currency. */
  purchase_price: string;
  selling_price: string;
  opening_stock: number;
}

export interface ImportResult {
  /** True when the server only planned the import and wrote nothing. */
  dry_run: boolean;
  created: number;
  updated: number;
  /** Rows rejected — may exceed `errors.length`, which the server caps. */
  skipped: number;
  /** Rows whose quantity was stocked in, new products and restocks alike. */
  stock_set: number;
  /** Purchases booked for that stock — one for the whole import, already paid. */
  purchases: number;
  /** On a dry run: what that purchase will come to, formatted in major units. */
  purchase_total: string;
  errors: ImportRowError[];
  /** Populated on a dry run; capped by the server, so possibly shorter than `created`. */
  creations: ImportCreation[];
  /** Populated on a dry run; capped by the server, so possibly shorter than `conflict_count`. */
  conflicts: ImportConflict[];
  /**
   * How many rows would change an existing product — rewrite a field, add stock,
   * or both. Lower than `updated`, which also counts rows that match a SKU
   * without changing anything.
   */
  conflict_count: number;
  /**
   * The subset of those that rewrite a field. This is the destructive number:
   * adding stock is undoable with a stock adjustment, a lost name is not.
   */
  overwrite_count: number;
}

async function downloadFile(path: string, fallbackName: string, params?: Record<string, string>) {
  const res = await api.get(path, { params, responseType: "blob" });
  downloadBlob(res.data as Blob, filenameFrom(res.headers["content-disposition"], fallbackName));
}

/**
 * The shop's whole catalogue. `.xlsx` is the round-trip format `importProducts`
 * reads back; `pdf` is a printable price list.
 */
export function exportProducts(format: "xlsx" | "pdf" = "xlsx") {
  return downloadFile("/products/export", `products.${format}`, { export: format });
}

/** A blank sheet with the expected header, for shops with nothing to export yet. */
export function downloadImportTemplate() {
  return downloadFile("/products/import-template", "products-import-template.xlsx");
}

/**
 * Upsert products from a sheet. Import is keyed on SKU, so a row reusing a SKU
 * replaces that product outright — always run `dryRun` first and show the
 * conflicts it returns before committing.
 */
export function useImportProducts() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: async ({ file, dryRun = false }: { file: File; dryRun?: boolean }) => {
      const form = new FormData();
      form.append("file", file);
      const params = dryRun ? { dry_run: "1" } : undefined;
      return (await api.post<ImportResult>("/products/import", form, { params })).data;
    },
    // A dry run changes nothing, so there is nothing to refetch.
    onSuccess: (result) => {
      if (!result.dry_run) invalidate();
    },
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
