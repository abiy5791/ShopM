import { Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { ShopSettings } from "@/types";

import { useSettings, useUpdateSettings } from "./api";

type FormState = Pick<ShopSettings, "currency" | "tax_rate" | "low_stock_default" | "timezone">;

/** Money & stock preferences for the active branch. */
export function PreferencesTab() {
  const { data, isLoading } = useSettings();
  const update = useUpdateSettings();
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (data && !form) {
      setForm({
        currency: data.currency,
        tax_rate: data.tax_rate,
        low_stock_default: data.low_stock_default,
        timezone: data.timezone,
      });
    }
  }, [data, form]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function save() {
    if (!form) return;
    try {
      await update.mutateAsync({ ...form, low_stock_default: Number(form.low_stock_default) });
      toast.success("Preferences saved");
    } catch {
      toast.error("Could not save preferences.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Money & stock</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading || !form ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <div className="max-w-xl space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Currency (ISO code)">
                <Input
                  value={form.currency}
                  onChange={(e) => set("currency", e.target.value.toUpperCase())}
                  maxLength={3}
                />
              </Field>
              <Field label="Tax rate (%)">
                <Input
                  inputMode="decimal"
                  value={form.tax_rate}
                  onChange={(e) => set("tax_rate", e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Low-stock alert default">
                <Input
                  type="number"
                  min={0}
                  value={form.low_stock_default}
                  onChange={(e) => set("low_stock_default", Number(e.target.value))}
                />
              </Field>
              <Field label="Timezone">
                <Input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              The low-stock default applies to new products that don't set their own alert level.
            </p>
            <div className="flex justify-end">
              <Button onClick={save} disabled={update.isPending}>
                {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
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
