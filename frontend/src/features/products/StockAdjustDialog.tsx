import { zodResolver } from "@hookform/resolvers/zod";
import { AxiosError } from "axios";
import { Loader2 } from "lucide-react";
import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import type { AdjustmentType, ApiError, Product } from "@/types";

import { useAdjustStock } from "./api";

const TYPES: { value: AdjustmentType; label: string }[] = [
  { value: "adjustment", label: "Adjustment (correction)" },
  { value: "damage", label: "Damage" },
  { value: "expiry", label: "Expiry" },
  { value: "return_in", label: "Customer return (in)" },
  { value: "return_out", label: "Return to supplier (out)" },
];

const schema = z.object({
  type: z.enum(["adjustment", "damage", "expiry", "return_in", "return_out"]),
  quantity: z.coerce
    .number()
    .int("Whole number")
    .refine((n) => n !== 0, "Quantity can't be zero"),
  notes: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export function StockAdjustDialog({
  product,
  onOpenChange,
}: {
  product: Product | null;
  onOpenChange: (open: boolean) => void;
}) {
  const adjust = useAdjustStock();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: { type: "adjustment", quantity: 0, notes: "" },
  });

  const qty = Number(watch("quantity")) || 0;
  const projected = (product?.stock_cached ?? 0) + qty;

  const onSubmit = handleSubmit(async (values) => {
    if (!product) return;
    setFormError(null);
    try {
      await adjust.mutateAsync({
        product: product.id,
        quantity: values.quantity,
        type: values.type,
        notes: values.notes,
      });
      toast.success(`Stock adjusted by ${values.quantity > 0 ? "+" : ""}${values.quantity}`);
      reset();
      onOpenChange(false);
    } catch (err) {
      const data = (err as AxiosError<ApiError>).response?.data;
      setFormError(data?.detail ?? "Could not adjust stock.");
    }
  });

  return (
    <Dialog open={Boolean(product)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>
            {product?.name} ({product?.sku}) — current stock{" "}
            <span className="font-mono font-medium tabular-nums">{product?.stock_cached}</span>
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

          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quantity">Quantity (signed: + adds, − removes)</Label>
            <Input
              id="quantity"
              type="number"
              aria-invalid={Boolean(errors.quantity)}
              {...register("quantity")}
            />
            {errors.quantity && (
              <p role="alert" className="text-xs text-destructive">
                {errors.quantity.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              New stock will be{" "}
              <span
                className={
                  projected < 0 ? "font-mono font-medium text-destructive" : "font-mono font-medium"
                }
              >
                {projected}
              </span>
              .
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Optional context for the audit trail"
              {...register("notes")}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Record adjustment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
