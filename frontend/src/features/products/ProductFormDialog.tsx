import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import { Loader2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { minorToInput, parseMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ApiError, Product } from "@/types";

import {
  useActiveCurrency,
  useCategories,
  useCreateCategory,
  useProductUnits,
  useSaveProduct,
  useSuppliers,
} from "./api";

const NONE = "none";

// Sensible defaults offered in the unit pick-list alongside the shop's own units.
const COMMON_UNITS = ["pcs", "kg", "g", "l", "ml", "box", "pack", "dozen", "meter", "pair", "set"];

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string(), // category NAME — resolved to an id (created if new) on submit
  supplier: z.string(),
  purchase_price: z
    .string()
    .refine(
      (v) => v !== "" && Number(v) >= 0 && Number.isFinite(Number(v)),
      "Enter a valid amount",
    ),
  selling_price: z
    .string()
    .refine(
      (v) => v !== "" && Number(v) >= 0 && Number.isFinite(Number(v)),
      "Enter a valid amount",
    ),
  unit: z.string().min(1, "Unit is required"),
  min_stock_alert: z.coerce.number().int("Whole number").min(0, "Must be ≥ 0"),
  status: z.enum(["active", "inactive"]),
  initial_stock: z.coerce.number().int("Whole number").min(0, "Must be ≥ 0"),
});
type FormValues = z.infer<typeof schema>;

function defaults(product?: Product, currency = "ETB"): FormValues {
  return {
    name: product?.name ?? "",
    category: product?.category_name ?? "",
    supplier: product?.supplier ?? NONE,
    purchase_price: product ? minorToInput(product.purchase_price, currency) : "0",
    selling_price: product ? minorToInput(product.selling_price, currency) : "0",
    unit: product?.unit ?? "pcs",
    min_stock_alert: product?.min_stock_alert ?? 0,
    status: product?.status ?? "active",
    initial_stock: 0,
  };
}

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: Product;
}) {
  const currency = useActiveCurrency();
  const categories = useCategories();
  const suppliers = useSuppliers();
  const units = useProductUnits();
  const createCategory = useCreateCategory();
  const save = useSaveProduct(product?.id);
  const [formError, setFormError] = useState<string | null>(null);

  // Unit suggestions: the shop's own units first, then common fallbacks.
  const unitOptions = useMemo(
    () => Array.from(new Set([...(units.data ?? []), ...COMMON_UNITS])),
    [units.data],
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    values: defaults(product, currency),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      // Resolve the typed category name to an id, creating the category if it's new.
      let categoryId: string | null = null;
      const catName = values.category.trim();
      if (catName) {
        const existing = (categories.data ?? []).find(
          (c) => c.name.toLowerCase() === catName.toLowerCase(),
        );
        categoryId = existing ? existing.id : (await createCategory.mutateAsync(catName)).id;
      }

      await save.mutateAsync({
        name: values.name,
        category: categoryId,
        supplier: values.supplier === NONE ? null : values.supplier,
        purchase_price: parseMoney(values.purchase_price, currency),
        selling_price: parseMoney(values.selling_price, currency),
        unit: values.unit,
        min_stock_alert: values.min_stock_alert,
        status: values.status,
        // Opening stock only when creating; edits change stock via the ledger.
        ...(product ? {} : { initial_stock: values.initial_stock }),
      });
      toast.success(product ? "Product updated" : "Product created");
      reset();
      onOpenChange(false);
    } catch (err) {
      const data = (err as AxiosError<ApiError>).response?.data;
      const fieldMsg = data?.fields && Object.values(data.fields)[0]?.[0];
      setFormError(fieldMsg ?? data?.detail ?? "Could not save the product.");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? "Edit product" : "New product"}</DialogTitle>
          <DialogDescription>
            {product
              ? `Prices are in ${currency}. Stock changes go through the stock ledger.`
              : `Prices are in ${currency}. The SKU is generated automatically; set an opening stock below.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <Field label="Name" error={errors.name?.message}>
            <Input aria-invalid={Boolean(errors.name)} {...register("name")} />
          </Field>

          {product && (
            <p className="text-xs text-muted-foreground">
              SKU <span className="font-mono font-medium text-foreground">{product.sku}</span>{" "}
              (auto-generated)
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Input
                list="product-category-options"
                placeholder="Type or pick — new ones are created"
                {...register("category")}
              />
              <datalist id="product-category-options">
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </Field>
            <Field label="Supplier">
              <Controller
                control={control}
                name="supplier"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {(suppliers.data ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={`Purchase price (${currency})`} error={errors.purchase_price?.message}>
              <Input
                inputMode="decimal"
                aria-invalid={Boolean(errors.purchase_price)}
                {...register("purchase_price")}
              />
            </Field>
            <Field label={`Selling price (${currency})`} error={errors.selling_price?.message}>
              <Input
                inputMode="decimal"
                aria-invalid={Boolean(errors.selling_price)}
                {...register("selling_price")}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Unit" error={errors.unit?.message}>
              <Input
                list="product-unit-options"
                aria-invalid={Boolean(errors.unit)}
                {...register("unit")}
              />
              <datalist id="product-unit-options">
                {unitOptions.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </Field>
            <Field label="Low-stock alert" error={errors.min_stock_alert?.message}>
              <Input type="number" min={0} {...register("min_stock_alert")} />
            </Field>
            <Field label="Status" className="col-span-2 sm:col-span-1">
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>

          {!product && (
            <Field label="Opening stock" error={errors.initial_stock?.message}>
              <Input
                type="number"
                min={0}
                aria-invalid={Boolean(errors.initial_stock)}
                {...register("initial_stock")}
              />
              <p className="text-xs text-muted-foreground">
                Units in stock now. Recorded in the stock ledger; adjust later from the product.
              </p>
            </Field>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {product ? "Save changes" : "Create product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  children,
  className,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
