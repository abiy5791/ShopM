import { Loader2, Moon, Sun } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useThemeStore } from "@/lib/theme";
import type { ShopSettings } from "@/types";

import { useSettings, useUpdateSettings } from "./api";

type FormState = Pick<
  ShopSettings,
  | "currency"
  | "tax_rate"
  | "receipt_footer"
  | "low_stock_default"
  | "language"
  | "timezone"
  | "logo_url"
>;

export default function SettingsPage() {
  const { data, isLoading } = useSettings();
  const update = useUpdateSettings();
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);

  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (data && !form) {
      setForm({
        currency: data.currency,
        tax_rate: data.tax_rate,
        receipt_footer: data.receipt_footer,
        low_stock_default: data.low_stock_default,
        language: data.language,
        timezone: data.timezone,
        logo_url: data.logo_url,
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
      toast.success("Settings saved");
    } catch {
      toast.error("Could not save settings.");
    }
  }

  return (
    <div>
      <PageHeader title="Settings" description="Shop configuration and appearance." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Shop preferences</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || !form ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
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
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Low-stock default">
                    <Input
                      type="number"
                      min={0}
                      value={form.low_stock_default}
                      onChange={(e) => set("low_stock_default", Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Language">
                    <Input
                      value={form.language}
                      onChange={(e) => set("language", e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Timezone">
                  <Input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} />
                </Field>
                <Field label="Logo URL">
                  <Input value={form.logo_url} onChange={(e) => set("logo_url", e.target.value)} />
                </Field>
                <Field label="Receipt footer">
                  <Input
                    value={form.receipt_footer}
                    onChange={(e) => set("receipt_footer", e.target.value)}
                  />
                </Field>
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

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Appearance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Dark mode</p>
                <p className="text-xs text-muted-foreground">Saved on this device.</p>
              </div>
              <Button variant="outline" size="sm" onClick={toggleTheme}>
                {theme === "dark" ? (
                  <>
                    <Sun className="h-4 w-4" /> Light
                  </>
                ) : (
                  <>
                    <Moon className="h-4 w-4" /> Dark
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
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
