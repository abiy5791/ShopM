import { useQueryClient } from "@tanstack/react-query";
import {
  Download,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import type { Product } from "@/types";

import { useActiveCurrency, useDeleteProduct, useProducts } from "./api";
import { ProductFormDialog } from "./ProductFormDialog";
import { StockAdjustDialog } from "./StockAdjustDialog";
import { TransactionsDialog } from "./TransactionsDialog";

export default function ProductsPage() {
  const role = useAuthStore(
    (s) => s.memberships.find((m) => m.shop_id === s.activeShopId)?.role ?? null,
  );
  const isOwner = role === "owner";
  const currency = useActiveCurrency();
  const queryClient = useQueryClient();
  const deleteProduct = useDeleteProduct();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | undefined>(undefined);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [historyFor, setHistoryFor] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);

  const { data, isLoading, isError, refetch } = useProducts({ search, lowStock, page });
  const rows = data?.results ?? [];
  const pageSize = 25;
  const from = data && data.count > 0 ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, data?.count ?? 0);

  function openCreate() {
    setEditing(undefined);
    setFormOpen(true);
  }
  function openEdit(p: Product) {
    setEditing(p);
    setFormOpen(true);
  }

  async function handleExport() {
    try {
      const res = await api.get("/products/export", { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "products.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed.");
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await api.post<{ created: number; updated: number; errors: unknown[] }>(
        "/products/import",
        form,
      );
      toast.success(`Imported: ${res.data.created} created, ${res.data.updated} updated`);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch {
      toast.error("Import failed. Check the file format.");
    }
  }

  async function handleDelete(p: Product) {
    try {
      await deleteProduct.mutateAsync(p.id);
      toast.success("Product deleted");
    } catch {
      toast.error("Could not delete product.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Products"
        description="Manage your catalogue. Stock is derived from the inventory ledger."
        actions={
          isOwner && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={handleImport}
              />
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" /> Import
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4" /> Export
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" /> New product
              </Button>
            </>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, SKU or barcode"
            className="pl-8"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Button
          variant={lowStock ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setLowStock((v) => !v);
            setPage(1);
          }}
        >
          <SlidersHorizontal className="h-4 w-4" /> Low stock only
        </Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-t-0">
              <TableHead>Product</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead>Status</TableHead>
              {isOwner && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: isOwner ? 7 : 6 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

            {!isLoading &&
              rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.sku}</TableCell>
                  <TableCell className="text-muted-foreground">{p.category_name ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatMoney(p.selling_price, currency)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <span className="inline-flex items-center gap-1.5">
                      {p.is_low_stock && (
                        <Badge variant="destructive" className="px-1.5 py-0">
                          low
                        </Badge>
                      )}
                      {p.stock_cached}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.status === "active" ? "secondary" : "outline"}>
                      {p.status}
                    </Badge>
                  </TableCell>
                  {isOwner && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Actions</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(p)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setAdjusting(p)}>
                            Adjust stock
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setHistoryFor(p)}>
                            Stock history
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleting(p)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
          </TableBody>
        </Table>

        {!isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <Package className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">
              {isError ? "Couldn't load products." : "No products found"}
            </p>
            <p className="text-xs text-muted-foreground">
              {isOwner ? "Add your first product to get started." : "Nothing matches your filters."}
            </p>
            {isError && (
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            )}
          </div>
        )}
      </Card>

      {data && data.count > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {from}–{to} of {data.count}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!data.previous}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!data.next}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {isOwner && (
        <>
          <ProductFormDialog open={formOpen} onOpenChange={setFormOpen} product={editing} />
          <StockAdjustDialog product={adjusting} onOpenChange={(o) => !o && setAdjusting(null)} />
          <TransactionsDialog
            product={historyFor}
            onOpenChange={(o) => !o && setHistoryFor(null)}
          />
          <ConfirmDialog
            open={deleting !== null}
            onOpenChange={(o) => !o && setDeleting(null)}
            title={`Delete ${deleting?.name ?? "product"}?`}
            description="The product leaves the catalog but its sales history is kept. An admin can restore it."
            confirmLabel="Delete product"
            onConfirm={() => deleting && handleDelete(deleting)}
          />
        </>
      )}
    </div>
  );
}
