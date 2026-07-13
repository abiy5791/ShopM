import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, Loader2, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Shop } from "@/types";

import { useArchiveShop, useCreateShop, useShops, useUpdateShop } from "./api";

/** Branches the caller owns: create, rename, archive (v2 plan §3). */
export function BranchesTab() {
  const shops = useShops();
  const archive = useArchiveShop();
  const [editing, setEditing] = useState<Shop | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<Shop | null>(null);

  const owned = (shops.data ?? []).filter((s) => s.my_role === "owner");

  async function confirmArchive() {
    if (!archiving) return;
    try {
      await archive.mutateAsync(archiving.id);
      toast.success(`${archiving.name} archived`);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail ?? "Could not archive the branch.");
    } finally {
      setArchiving(null);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Each branch keeps its own catalog, stock, sales, and settings.
          </p>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add branch
          </Button>
        </div>

        {shops.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : owned.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            You don't own any branches yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {owned.map((shop) => (
                <TableRow key={shop.id}>
                  <TableCell className="font-medium">{shop.name}</TableCell>
                  <TableCell className="text-muted-foreground">{shop.address || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{shop.phone || "—"}</TableCell>
                  <TableCell>{shop.currency}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Edit ${shop.name}`}
                      onClick={() => setEditing(shop)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      aria-label={`Archive ${shop.name}`}
                      disabled={owned.length <= 1}
                      title={owned.length <= 1 ? "You can't archive your only branch." : undefined}
                      onClick={() => setArchiving(shop)}
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <BranchFormDialog
          open={creating || editing !== null}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
          branch={editing ?? undefined}
        />

        <AlertDialog open={archiving !== null} onOpenChange={(o) => !o && setArchiving(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive {archiving?.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                The branch disappears from the shop switcher and stops taking sales. Its sales
                history and reports are kept.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep branch</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={confirmArchive}>
                Archive branch
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  address: z.string(),
  phone: z.string(),
});
type FormValues = z.infer<typeof schema>;

function BranchFormDialog({
  open,
  onOpenChange,
  branch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch?: Shop;
}) {
  const create = useCreateShop();
  const update = useUpdateShop();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    values: {
      name: branch?.name ?? "",
      address: branch?.address ?? "",
      phone: branch?.phone ?? "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (branch) {
        await update.mutateAsync({ id: branch.id, ...values });
        toast.success("Branch updated");
      } else {
        await create.mutateAsync(values);
        toast.success("Branch created — it's now in your shop switcher");
      }
      onOpenChange(false);
    } catch {
      toast.error("Could not save the branch.");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{branch ? `Edit ${branch.name}` : "Add branch"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="branch-name">Name</Label>
            <Input id="branch-name" {...register("name")} placeholder="e.g. Piassa" />
            {errors.name && (
              <p role="alert" className="text-xs text-destructive">
                {errors.name.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branch-address">Address</Label>
            <Input id="branch-address" {...register("address")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branch-phone">Phone</Label>
            <Input id="branch-phone" {...register("phone")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {branch ? "Save changes" : "Create branch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
