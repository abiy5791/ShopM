import { History, Pencil, SlidersHorizontal, Trash2 } from "lucide-react";

import { DetailField } from "@/components/detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import type { Product } from "@/types";

/** A product at a glance, with the owner actions that live in the desktop
 *  dropdown surfaced as buttons — the primary way to act on a product on a
 *  phone. Each action closes this dialog and opens the relevant one. */
export function ProductDetailDialog({
  product,
  currency,
  isOwner,
  onOpenChange,
  onEdit,
  onAdjust,
  onHistory,
  onDelete,
}: {
  product: Product | null;
  currency: string;
  isOwner: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onAdjust: () => void;
  onHistory: () => void;
  onDelete: () => void;
}) {
  if (!product) return null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            {product.name}
            <Badge variant={product.status === "active" ? "secondary" : "outline"}>
              {product.status}
            </Badge>
            {product.is_low_stock && <Badge variant="destructive">low stock</Badge>}
          </DialogTitle>
        </DialogHeader>

        {/* Price + stock readout */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border p-3">
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Selling price
            </p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
              {formatMoney(product.selling_price, currency)}
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              In stock
            </p>
            <p
              className={
                "mt-1 font-mono text-lg font-semibold tabular-nums" +
                (product.is_low_stock ? " text-destructive" : "")
              }
            >
              {product.stock_cached} {product.unit}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-2">
          <DetailField label="SKU">
            <span className="font-mono">{product.sku}</span>
          </DetailField>
          <DetailField label="Barcode">
            <span className="font-mono">{product.barcode || "—"}</span>
          </DetailField>
          <DetailField label="Category">{product.category_name ?? "—"}</DetailField>
          <DetailField label="Supplier">{product.supplier_name ?? "—"}</DetailField>
          <DetailField label="Purchase price">
            {formatMoney(product.purchase_price, currency)}
          </DetailField>
          <DetailField label="Low-stock alert">{product.min_stock_alert}</DetailField>
        </dl>

        {isOwner && (
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-start">
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
            <Button variant="outline" size="sm" onClick={onAdjust}>
              <SlidersHorizontal className="h-4 w-4" /> Adjust stock
            </Button>
            <Button variant="outline" size="sm" onClick={onHistory}>
              <History className="h-4 w-4" /> Stock history
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive sm:ml-auto"
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
