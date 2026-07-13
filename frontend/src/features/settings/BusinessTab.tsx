import { Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/auth";

import { useSettings, useShops, useUpdateSettings, useUpdateShop } from "./api";

interface FormState {
  name: string;
  address: string;
  phone: string;
  logo_url: string;
  receipt_footer: string;
}

/** The active branch's public identity: what customers see on receipts. */
export function BusinessTab() {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  const shops = useShops();
  const settings = useSettings();
  const updateShop = useUpdateShop();
  const updateSettings = useUpdateSettings();

  const shop = shops.data?.find((s) => s.id === activeShopId);
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (shop && settings.data && !form) {
      setForm({
        name: shop.name,
        address: shop.address,
        phone: shop.phone,
        logo_url: settings.data.logo_url,
        receipt_footer: settings.data.receipt_footer,
      });
    }
  }, [shop, settings.data, form]);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  const saving = updateShop.isPending || updateSettings.isPending;

  async function save() {
    if (!form || !shop) return;
    if (!form.name.trim()) {
      toast.error("Give the branch a name.");
      return;
    }
    try {
      await Promise.all([
        updateShop.mutateAsync({
          id: shop.id,
          name: form.name,
          address: form.address,
          phone: form.phone,
        }),
        updateSettings.mutateAsync({
          logo_url: form.logo_url,
          receipt_footer: form.receipt_footer,
        }),
      ]);
      toast.success("Business details saved");
    } catch {
      toast.error("Could not save business details.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Business details — {shop?.name ?? "…"}</CardTitle>
      </CardHeader>
      <CardContent>
        {!form ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <div className="max-w-xl space-y-4">
            <Field label="Branch name">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone">
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label="Address">
                <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
              </Field>
            </div>
            <Field label="Logo URL">
              <Input value={form.logo_url} onChange={(e) => set("logo_url", e.target.value)} />
            </Field>
            <Field label="Receipt footer">
              <Input
                value={form.receipt_footer}
                onChange={(e) => set("receipt_footer", e.target.value)}
                placeholder="e.g. Thank you for shopping with us!"
              />
            </Field>
            <div className="flex justify-end">
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
