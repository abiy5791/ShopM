import { AlertTriangle, ArrowRight, Loader2, PackagePlus, PlusCircle, XCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { ImportConflict, ImportCreation, ImportResult, ImportRowError } from "./api";

/** Sheet column names as headings, so the diff reads like the file. */
const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  barcode: "Barcode",
  unit: "Unit",
  purchase_price: "Purchase price",
  selling_price: "Selling price",
  min_stock_alert: "Min stock alert",
  status: "Status",
  category: "Category",
  supplier: "Supplier",
};

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** An empty cell reads as nothing at all otherwise. */
function value(text: string) {
  return text === "" ? "—" : text;
}

/** Both server lists are capped, the counts beside them are not. */
function Truncated({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <p className="px-1 py-2 text-sm text-muted-foreground">…and {total - shown} more not shown.</p>
  );
}

function CreationTable({ rows }: { rows: ImportCreation[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>SKU</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Supplier</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right">Opening stock</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.row}-${row.sku}`}>
            <TableCell className="font-mono">{row.sku}</TableCell>
            <TableCell>{row.name}</TableCell>
            <TableCell className="text-muted-foreground">{value(row.supplier)}</TableCell>
            <TableCell className="text-right tabular-nums">{row.purchase_price}</TableCell>
            <TableCell className="text-right tabular-nums">{row.selling_price}</TableCell>
            <TableCell className="text-right tabular-nums">{row.opening_stock || "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * One existing product this sheet touches.
 *
 * Rewriting a field and adding stock are different stakes — stock can be put
 * back with an adjustment, an overwritten name cannot — so only a row that
 * rewrites something is drawn as a warning.
 */
function ConflictRow({ conflict }: { conflict: ImportConflict }) {
  const overwrites = conflict.changes.length > 0;
  return (
    <li
      className={
        overwrites
          ? "rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
          : "rounded-md border bg-muted/40 p-3 text-sm"
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono font-medium">{conflict.sku}</span>
        <span className="text-muted-foreground">
          row {conflict.row}
          {conflict.duplicate_of_row !== null
            ? ` — same SKU as row ${conflict.duplicate_of_row} of this file`
            : ` — ${overwrites ? "replaces" : "restocks"} “${conflict.existing_name}”`}
        </span>
      </div>
      {conflict.opening_stock > 0 && (
        <p className="mt-2 flex items-baseline gap-2">
          <span className="min-w-28 text-muted-foreground">Stock</span>
          <span className="font-medium text-emerald-700 tabular-nums dark:text-emerald-500">
            +{conflict.opening_stock}
          </span>
        </p>
      )}
      <dl className="mt-1 space-y-1">
        {conflict.changes.map((change) => (
          <div key={change.field} className="flex flex-wrap items-baseline gap-x-2">
            <dt className="min-w-28 text-muted-foreground">
              {FIELD_LABELS[change.field] ?? change.field}
            </dt>
            <dd className="flex items-baseline gap-2">
              <span className="line-through opacity-70">{value(change.from)}</span>
              <ArrowRight className="h-3 w-3 shrink-0 self-center opacity-60" />
              <span className="font-medium">{value(change.to)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

function ErrorRow({ error }: { error: ImportRowError }) {
  return (
    <li className="rounded-md border bg-muted/40 p-3 text-sm">
      <span className="text-muted-foreground">Row {error.row}</span> — {error.error}
    </li>
  );
}

/**
 * What the uploaded sheet would do, always shown before anything is written.
 *
 * A spreadsheet is opaque until it has landed, and import upserts on SKU: a row
 * reusing one overwrites an unrelated product, and the sales already recorded
 * against it then read under the new name. That is only recoverable from a
 * database backup, so the whole plan is shown first and the import waits for an
 * explicit confirmation.
 */
export function ImportPreviewDialog({
  preview,
  fileName,
  importing,
  onConfirm,
  onCancel,
}: {
  preview: ImportResult | null;
  fileName: string;
  importing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const existing = preview?.conflict_count ?? 0;
  // The existing products are the part the user actually has to decide about,
  // so open there whenever the sheet touches any.
  const [tab, setTab] = useState(existing > 0 ? "existing" : "new");
  if (!preview) return null;

  const { created, updated, creations, conflicts, skipped, errors, stock_set } = preview;
  const overwrites = preview.overwrite_count;
  // Rows that only add stock. Worth its own, calmer notice: the risk there is
  // double-counting a sheet, not losing a product's identity.
  const restocks = conflicts.filter((c) => c.opening_stock > 0 && c.changes.length === 0).length;
  const nothingToDo = created === 0 && updated === 0;

  return (
    <Dialog open onOpenChange={(open) => !open && !importing && onCancel()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Preview import</DialogTitle>
          <DialogDescription>
            {fileName} — nothing has been imported yet. Review what this file will do, then confirm.
          </DialogDescription>
        </DialogHeader>

        {overwrites > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>
              <span className="font-medium">
                {plural(overwrites, "existing product")} will be overwritten.
              </span>{" "}
              These SKUs are already in your catalogue. Their stock and sales history stay, but they
              will be renamed and repriced — and past sales will then show under the new name. This
              cannot be undone.
            </p>
          </div>
        )}
        {restocks > 0 && (
          <div className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm">
            <PackagePlus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p>
              <span className="font-medium">
                {plural(restocks, "product")} already in your catalogue will be restocked.
              </span>{" "}
              Their quantities are added on top of what you have now, so importing the same sheet
              twice adds the stock twice. Check the Existing tab before confirming.
            </p>
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="new">
              <PlusCircle className="h-3.5 w-3.5" /> New ({created})
            </TabsTrigger>
            <TabsTrigger value="existing">
              <AlertTriangle className="h-3.5 w-3.5" /> Existing ({existing})
            </TabsTrigger>
            <TabsTrigger value="skipped">
              <XCircle className="h-3.5 w-3.5" /> Skipped ({skipped})
            </TabsTrigger>
          </TabsList>

          <div className="mt-3 max-h-80 overflow-y-auto">
            <TabsContent value="new">
              {created === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No new products — every SKU in this file is already in your catalogue.
                </p>
              ) : (
                <>
                  <CreationTable rows={creations} />
                  <Truncated shown={creations.length} total={created} />
                </>
              )}
            </TabsContent>

            <TabsContent value="existing">
              {existing === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No SKU in this file changes a product you already have.
                </p>
              ) : (
                <>
                  <ul className="space-y-2">
                    {conflicts.map((conflict) => (
                      <ConflictRow key={`${conflict.row}-${conflict.sku}`} conflict={conflict} />
                    ))}
                  </ul>
                  <Truncated shown={conflicts.length} total={existing} />
                </>
              )}
            </TabsContent>

            <TabsContent value="skipped">
              {skipped === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  Every row in this file can be imported.
                </p>
              ) : (
                <>
                  <ul className="space-y-2">
                    {errors.map((error) => (
                      <ErrorRow key={`${error.row}-${error.error}`} error={error} />
                    ))}
                  </ul>
                  <Truncated shown={errors.length} total={skipped} />
                </>
              )}
            </TabsContent>
          </div>
        </Tabs>

        {stock_set > 0 && (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <PackagePlus className="mr-2 inline h-4 w-4 align-text-bottom text-muted-foreground" />
            {plural(stock_set, "row")} carry a quantity. They will be stocked in as{" "}
            <span className="font-medium">one paid purchase</span> for this import, totalling{" "}
            <span className="font-medium tabular-nums">{preview.purchase_total}</span> — cost ×
            quantity, summed across every one of them.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={importing}>
            Cancel
          </Button>
          <Button
            variant={overwrites > 0 ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={importing || nothingToDo}
          >
            {importing && <Loader2 className="h-4 w-4 animate-spin" />}
            {importing
              ? "Importing…"
              : nothingToDo
                ? "Nothing to import"
                : overwrites > 0
                  ? `Import, overwriting ${plural(overwrites, "product")}`
                  : `Import ${plural(created, "product")}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
