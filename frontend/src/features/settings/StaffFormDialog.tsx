import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
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
import { useAuthStore } from "@/lib/auth";
import type { ApiError } from "@/types";

import { useCreateStaff, useShops } from "./api";

const schema = z.object({
  full_name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
  role: z.enum(["owner", "cashier"]),
  shops: z.array(z.string()).min(1, "Pick at least one branch"),
});
type FormValues = z.infer<typeof schema>;

export function StaffFormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateStaff();
  const shopsQuery = useShops();
  const activeShopId = useAuthStore((s) => s.activeShopId);
  const owned = (shopsQuery.data ?? []).filter((s) => s.my_role === "owner");

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    values: {
      full_name: "",
      email: "",
      password: "",
      role: "cashier",
      shops: activeShopId ? [activeShopId] : [],
    },
  });
  const selectedShops = watch("shops");
  const role = watch("role");

  function toggleShop(id: string) {
    const next = selectedShops.includes(id)
      ? selectedShops.filter((s) => s !== id)
      : [...selectedShops, id];
    setValue("shops", next, { shouldValidate: true });
  }

  const onSubmit = handleSubmit(async (values) => {
    try {
      await create.mutateAsync({
        full_name: values.full_name,
        email: values.email,
        password: values.password,
        memberships: values.shops.map((shop) => ({ shop, role: values.role })),
      });
      toast.success(`${values.full_name} can now sign in`);
      onOpenChange(false);
    } catch (err) {
      const data = (err as { response?: { data?: ApiError } })?.response?.data;
      const pwErrors = data?.fields?.password;
      if (pwErrors?.length) {
        setError("password", { message: pwErrors.join(" ") });
      } else if (data?.fields?.email?.length) {
        setError("email", { message: data.fields.email.join(" ") });
      } else {
        toast.error(data?.detail ?? "Could not create the account.");
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add staff</DialogTitle>
          <DialogDescription>
            Creates an account they can sign in with right away.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="staff-name">Full name</Label>
            <Input id="staff-name" {...register("full_name")} />
            {errors.full_name && (
              <p role="alert" className="text-xs text-destructive">
                {errors.full_name.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-email">Email</Label>
            <Input id="staff-email" type="email" autoComplete="off" {...register("email")} />
            {errors.email && (
              <p role="alert" className="text-xs text-destructive">
                {errors.email.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-password">Password</Label>
            <Input
              id="staff-password"
              type="password"
              autoComplete="new-password"
              {...register("password")}
            />
            {errors.password && (
              <p role="alert" className="text-xs text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setValue("role", v as "owner" | "cashier")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cashier">Cashier — POS and customers only</SelectItem>
                <SelectItem value="owner">Manager — full access in their branches</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Branches</Label>
            <div className="space-y-1 rounded-md border p-2">
              {owned.map((shop) => (
                <label key={shop.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedShops.includes(shop.id)}
                    onChange={() => toggleShop(shop.id)}
                  />
                  {shop.name}
                </label>
              ))}
            </div>
            {errors.shops && (
              <p role="alert" className="text-xs text-destructive">
                {errors.shops.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Create account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
