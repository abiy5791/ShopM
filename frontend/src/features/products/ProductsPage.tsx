import { isAxiosError } from "axios";
import {
  Download as DownloadIcon,
  FileSpreadsheet,
  FileText,
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
import { KpiRow } from "@/components/kpi";
import { ListCard, Fact } from "@/components/list-card";
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
import { useAuthStore } from "@/lib/auth";
import { readBlobError } from "@/lib/download";
import { formatMoney } from "@/lib/money";
import { useSummary } from "@/lib/summary";
import type { Product } from "@/types";

import {
  downloadImportTemplate,
  exportProducts,
  type ImportResult,
  useActiveCurrency,
  useDeleteProduct,
  useImportProducts,
  useProducts,
} from "./api";
import { ImportPreviewDialog } from "./ImportPreviewDialog";
import { ProductDetailDialog } from "./ProductDetailDialog";
import { ProductFormDialog } from "./ProductFormDialog";
import { StockAdjustDialog } from "./StockAdjustDialog";
import { TransactionsDialog } from "./TransactionsDialog";

/** The three files this page can hand back. */
type Download = "xlsx" | "pdf" | "template";

/** "2 added, 1 updated" — only the parts that actually happened. */
function summarise({ created, updated }: ImportResult): string {
  const parts: string[] = [];
  if (created) parts.push(`${created} added`);
  if (updated) parts.push(`${updated} updated`);
  return parts.join(", ") || "No products imported";
}

export default function ProductsPage() {
  const role = useAuthStore(
    (s) => s.memberships.find((m) => m.shop_id === s.activeShopId)?.role ?? null,
  );
  const isOwner = role === "owner";
  const currency = useActiveCurrency();
  const deleteProduct = useDeleteProduct();
  const importProducts = useImportProducts();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState<Download | null>(null);
  // The planned import awaiting confirmation. The file is kept alongside it so
  // confirming re-sends the very bytes that were previewed.
  const [pending, setPending] = useState<{ file: File; preview: ImportResult } | null>(null);

  const [search, setSearch] = useState("");
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | undefined>(undefined);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [historyFor, setHistoryFor] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [detail, setDetail] = useState<Product | null>(null);

  const { data, isLoading, isError, refetch } = useProducts({ search, lowStock, page });
  // The server picks the card set by role — valuation for owners, stock counts
  // for cashiers — so both see a row.
  const summary = useSummary("products");
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

  async function handleDownload(what: Download) {
    setDownloading(what);
    try {
      await (what === "template" ? downloadImportTemplate() : exportProducts(what));
    } catch (error) {
      // Blob responses hide the server's message until it's read back as text.
      const detail = isAxiosError(error) ? await readBlobError(error.response?.data) : null;
      toast.error(detail ?? "Download failed. Please try again.");
    } finally {
      setDownloading(null);
    }
  }

  /** Report a finished (non-dry) import: what landed, and the first row that didn't. */
  function reportImport(result: ImportResult) {
    const stock = result.stock_set
      ? `Stock recorded for ${result.stock_set} product${
          result.stock_set === 1 ? "" : "s"
        } as one paid purchase.`
      : undefined;
    if (result.skipped === 0) {
      toast.success(summarise(result), { description: stock });
      return;
    }
    // Skipped rows are the whole point of the report — name the first one so
    // the user can find it in Excel instead of guessing.
    const [first] = result.errors;
    toast.warning(`${summarise(result)}, ${result.skipped} skipped`, {
      description: first ? `Row ${first.row}: ${first.error}` : stock,
      duration: 8000,
    });
  }

  function reportImportError(error: unknown) {
    const detail = isAxiosError<{ detail?: string }>(error) ? error.response?.data?.detail : null;
    toast.error(detail ?? "Import failed. Check the file format.");
  }

  /**
   * Choosing a file only *plans* the import; the preview commits it. A
   * spreadsheet is opaque until it has landed, and import upserts on SKU — a
   * sheet reusing one overwrites an unrelated product — so the plan is always
   * shown first, never applied straight from the file picker.
   */
  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    try {
      setPending({ file, preview: await importProducts.mutateAsync({ file, dryRun: true }) });
    } catch (error) {
      reportImportError(error);
    }
  }

  async function confirmImport() {
    if (!pending) return;
    try {
      reportImport(await importProducts.mutateAsync({ file: pending.file }));
    } catch (error) {
      reportImportError(error);
    } finally {
      setPending(null);
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
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={handleImport}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={importProducts.isPending}>
                    <Upload className="h-4 w-4" />
                    {/* The first pass only plans the import, so don't call it importing. */}
                    {importProducts.isPending && !pending ? "Reading…" : "Import"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4" /> Choose .xlsx file…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={downloading === "template"}
                    onSelect={() => void handleDownload("template")}
                  >
                    <FileSpreadsheet className="h-4 w-4" /> Download template
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={downloading === "xlsx" || downloading === "pdf"}
                  >
                    <DownloadIcon className="h-4 w-4" />
                    {downloading === "xlsx" || downloading === "pdf" ? "Exporting…" : "Export"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void handleDownload("xlsx")}>
                    <FileSpreadsheet className="h-4 w-4" /> Excel (.xlsx)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void handleDownload("pdf")}>
                    <FileText className="h-4 w-4" /> PDF catalogue
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" /> New product
              </Button>
            </>
          )
        }
      />

      <KpiRow summary={summary.data} loading={summary.isLoading} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full flex-1 sm:max-w-xs">
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
        {/* Desktop table */}
        <div className="hidden md:block">
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
                  <TableRow
                    key={p.id}
                    tabIndex={0}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => setDetail(p)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetail(p);
                      }
                    }}
                  >
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {p.sku}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.category_name ?? "—"}
                    </TableCell>
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
                      <TableCell onClick={(e) => e.stopPropagation()}>
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
        </div>

        {/* Mobile cards */}
        <ul className="divide-y md:hidden">
          {isLoading &&
            Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="px-4 py-3">
                <Skeleton className="h-10 w-full" />
              </li>
            ))}
          {!isLoading &&
            rows.map((p) => (
              <li key={p.id}>
                <ListCard
                  onClick={() => setDetail(p)}
                  title={p.name}
                  subtitle={p.sku}
                  meta={
                    <>
                      <Fact label="Cat">{p.category_name ?? "—"}</Fact>
                      {p.is_low_stock && <Badge variant="destructive">low stock</Badge>}
                    </>
                  }
                  trailing={
                    <>
                      <span className="font-mono text-sm font-semibold tabular-nums">
                        {formatMoney(p.selling_price, currency)}
                      </span>
                      <span
                        className={
                          "font-mono text-xs tabular-nums" +
                          (p.is_low_stock ? " text-destructive" : " text-muted-foreground")
                        }
                      >
                        {p.stock_cached} in stock
                      </span>
                    </>
                  }
                />
              </li>
            ))}
        </ul>

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
          {(data.previous || data.next) && (
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
          )}
        </div>
      )}

      <ProductDetailDialog
        product={detail}
        currency={currency}
        isOwner={isOwner}
        onOpenChange={(o) => !o && setDetail(null)}
        onEdit={() => {
          const p = detail;
          setDetail(null);
          if (p) openEdit(p);
        }}
        onAdjust={() => {
          const p = detail;
          setDetail(null);
          setAdjusting(p);
        }}
        onHistory={() => {
          const p = detail;
          setDetail(null);
          setHistoryFor(p);
        }}
        onDelete={() => {
          const p = detail;
          setDetail(null);
          setDeleting(p);
        }}
      />

      {isOwner && (
        <>
          <ProductFormDialog open={formOpen} onOpenChange={setFormOpen} product={editing} />
          <StockAdjustDialog product={adjusting} onOpenChange={(o) => !o && setAdjusting(null)} />
          <TransactionsDialog
            product={historyFor}
            onOpenChange={(o) => !o && setHistoryFor(null)}
          />
          <ImportPreviewDialog
            key={pending?.file.name}
            preview={pending?.preview ?? null}
            fileName={pending?.file.name ?? ""}
            importing={importProducts.isPending}
            onConfirm={() => void confirmImport()}
            onCancel={() => setPending(null)}
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
