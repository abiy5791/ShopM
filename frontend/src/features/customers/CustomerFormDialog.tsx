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
import type { Customer } from "@/types";

import { useSaveCustomer } from "./api";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string(),
  address: z.string(),
  notes: z.string(),
});
type FormValues = z.infer<typeof schema>;

export function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Customer;
}) {
  const save = useSaveCustomer(customer?.id);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    values: {
      name: customer?.name ?? "",
      phone: customer?.phone ?? "",
      address: customer?.address ?? "",
      notes: customer?.notes ?? "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync(values);
      toast.success(customer ? "Customer updated" : "Customer added");
      onOpenChange(false);
    } catch {
      toast.error("Could not save the customer.");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{customer ? "Edit customer" : "New customer"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" aria-invalid={Boolean(errors.name)} {...register("name")} />
            {errors.name && (
              <p role="alert" className="text-xs text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" {...register("phone")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">Address</Label>
            <Input id="address" {...register("address")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" {...register("notes")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {customer ? "Save changes" : "Add customer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
