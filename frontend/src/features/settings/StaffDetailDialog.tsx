import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import { PasswordInput } from "@/components/password-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ApiError, StaffMember } from "@/types";

import { useAddStaffMembership, useRemoveStaffMembership, useShops, useUpdateStaff } from "./api";

/** Manage one staff member: profile, password, activation, branch access. */
export function StaffDetailDialog({
  member,
  onOpenChange,
}: {
  member: StaffMember | null;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateStaff();
  const addMembership = useAddStaffMembership();
  const removeMembership = useRemoveStaffMembership();
  const shopsQuery = useShops();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [grantShop, setGrantShop] = useState("");
  const [grantRole, setGrantRole] = useState<"owner" | "cashier">("cashier");

  useEffect(() => {
    if (member) {
      setFullName(member.full_name);
      setEmail(member.email);
      setPassword("");
      setGrantShop("");
    }
  }, [member]);

  if (!member) {
    return null;
  }

  const owned = (shopsQuery.data ?? []).filter((s) => s.my_role === "owner");
  const assignedShopIds = new Set(member.memberships.map((m) => m.shop_id));
  const grantable = owned.filter((s) => !assignedShopIds.has(s.id));

  async function saveProfile() {
    if (!member) return;
    try {
      await update.mutateAsync({
        id: member.id,
        full_name: fullName,
        email,
        ...(password ? { password } : {}),
      });
      toast.success(password ? "Profile saved and password reset" : "Profile saved");
      setPassword("");
    } catch (err) {
      const data = (err as { response?: { data?: ApiError } })?.response?.data;
      const fieldError = data?.fields?.password?.[0] ?? data?.fields?.email?.[0];
      toast.error(fieldError ?? data?.detail ?? "Could not save the profile.");
    }
  }

  async function setActive(active: boolean) {
    if (!member) return;
    try {
      await update.mutateAsync({ id: member.id, is_active: active });
      toast.success(active ? "Account reactivated" : "Account deactivated");
    } catch {
      toast.error("Could not change the account status.");
    } finally {
      setConfirmDeactivate(false);
    }
  }

  async function grant() {
    if (!member || !grantShop) return;
    try {
      await addMembership.mutateAsync({ staffId: member.id, shop: grantShop, role: grantRole });
      toast.success("Branch access granted");
      setGrantShop("");
    } catch {
      toast.error("Could not grant branch access.");
    }
  }

  async function revoke(membershipId: string, shopName: string) {
    if (!member) return;
    try {
      await removeMembership.mutateAsync({ staffId: member.id, membershipId });
      toast.success(`Access to ${shopName} removed`);
    } catch {
      toast.error("Could not remove branch access.");
    }
  }

  const busy = update.isPending || addMembership.isPending || removeMembership.isPending;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {member.full_name}
            {!member.is_active && <Badge variant="secondary">Deactivated</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Profile */}
          <section className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="detail-name">Full name</Label>
                <Input
                  id="detail-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="detail-email">Email</Label>
                <Input id="detail-email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="detail-password">New password (optional)</Label>
              <PasswordInput
                id="detail-password"
                autoComplete="new-password"
                placeholder="Leave blank to keep the current password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={saveProfile} disabled={busy}>
                {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save profile
              </Button>
            </div>
          </section>

          {/* Branch access */}
          <section className="space-y-2">
            <Label>Branch access</Label>
            <ul className="space-y-1.5">
              {member.memberships.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
                >
                  <span>
                    {m.shop_name} <Badge variant="secondary">{m.role}</Badge>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    aria-label={`Remove access to ${m.shop_name}`}
                    disabled={busy || member.memberships.length <= 1}
                    title={
                      member.memberships.length <= 1
                        ? "Staff need at least one branch — deactivate the account instead."
                        : undefined
                    }
                    onClick={() => revoke(m.id, m.shop_name)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
            {grantable.length > 0 && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select value={grantShop} onValueChange={setGrantShop}>
                  <SelectTrigger className="w-full sm:h-8 sm:flex-1">
                    <SelectValue placeholder="Add a branch…" />
                  </SelectTrigger>
                  <SelectContent>
                    {grantable.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Select
                    value={grantRole}
                    onValueChange={(v) => setGrantRole(v as "owner" | "cashier")}
                  >
                    <SelectTrigger className="flex-1 sm:h-8 sm:w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cashier">Cashier</SelectItem>
                      <SelectItem value="owner">Manager</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button className="shrink-0 sm:h-8" onClick={grant} disabled={!grantShop || busy}>
                    Add
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* Activation */}
          <section className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">
                {member.is_active ? "Deactivate account" : "Reactivate account"}
              </p>
              <p className="text-xs text-muted-foreground">
                {member.is_active
                  ? "Blocks sign-in immediately. Their sales history is kept."
                  : "Lets them sign in again."}
              </p>
            </div>
            {member.is_active ? (
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmDeactivate(true)}
              >
                Deactivate
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setActive(true)}>
                Reactivate
              </Button>
            )}
          </section>
        </div>

        <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Deactivate {member.full_name}?</AlertDialogTitle>
              <AlertDialogDescription>
                They are signed out and can't sign back in until reactivated.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => setActive(false)}>
                Deactivate
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
