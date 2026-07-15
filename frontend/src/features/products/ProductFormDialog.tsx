import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import { Loader2 } from "lucide-react";
import { type ReactNode, useState } from "react";
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

import { useActiveCurrency, useCategories, useSaveProduct, useSuppliers } from "./api";

const NONE = "none";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  sku: z.string().min(1, "SKU is required"),
  barcode: z.string(),
  category: z.string(),
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
});
type FormValues = z.infer<typeof schema>;

function defaults(product?: Product, currency = "ETB"): FormValues {
  return {
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    category: product?.category ?? NONE,
    supplier: product?.supplier ?? NONE,
    purchase_price: product ? minorToInput(product.purchase_price, currency) : "0",
    selling_price: product ? minorToInput(product.selling_price, currency) : "0",
    unit: product?.unit ?? "pcs",
    min_stock_alert: product?.min_stock_alert ?? 0,
    status: product?.status ?? "active",
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
  const save = useSaveProduct(product?.id);
  const [formError, setFormError] = useState<string | null>(null);

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
      await save.mutateAsync({
        name: values.name,
        sku: values.sku,
        barcode: values.barcode,
        category: values.category === NONE ? null : values.category,
        supplier: values.supplier === NONE ? null : values.supplier,
        purchase_price: parseMoney(values.purchase_price, currency),
        selling_price: parseMoney(values.selling_price, currency),
        unit: values.unit,
        min_stock_alert: values.min_stock_alert,
        status: values.status,
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
            Prices are in {currency}. Stock is managed via the ledger, not here.
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU" error={errors.sku?.message}>
              <Input aria-invalid={Boolean(errors.sku)} {...register("sku")} />
            </Field>
            <Field label="Barcode" error={errors.barcode?.message}>
              <Input {...register("barcode")} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Uncategorised" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Uncategorised</SelectItem>
                      {(categories.data ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
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
              <Input {...register("unit")} />
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
