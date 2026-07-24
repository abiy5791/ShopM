import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Supplier } from "@/types";

import { useSaveSupplier } from "./api";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string(),
  address: z.string(),
  notes: z.string(),
});
type FormValues = z.infer<typeof schema>;

export function SupplierFormDialog({
  open,
  onOpenChange,
  supplier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier?: Supplier;
}) {
  const save = useSaveSupplier(supplier?.id);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    values: {
      name: supplier?.name ?? "",
      phone: supplier?.phone ?? "",
      address: supplier?.address ?? "",
      notes: supplier?.notes ?? "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync(values);
      toast.success(supplier ? "Supplier updated" : "Supplier added");
      onOpenChange(false);
    } catch {
      toast.error("Could not save the supplier.");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{supplier ? "Edit supplier" : "New supplier"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="supplier-name">Name</Label>
            <Input id="supplier-name" aria-invalid={Boolean(errors.name)} {...register("name")} />
            {errors.name && (
              <p role="alert" className="text-xs text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-phone">Phone</Label>
            <Input id="supplier-phone" {...register("phone")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-address">Address</Label>
            <Input id="supplier-address" {...register("address")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-notes">Notes</Label>
            <Textarea id="supplier-notes" {...register("notes")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {supplier ? "Save changes" : "Add supplier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
