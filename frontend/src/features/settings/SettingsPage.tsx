import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { ShopSettings } from "@/types";

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between border-b py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export default function SettingsPage() {
  const activeShopId = useAuthStore((s) => s.activeShopId);

  const { data, isLoading } = useQuery({
    queryKey: ["settings", activeShopId],
    enabled: Boolean(activeShopId),
    queryFn: async () => {
      const res = await api.get<ShopSettings>("/settings");
      return res.data;
    },
  });

  return (
    <div>
      <PageHeader title="Settings" description="Shop configuration. Editing UI ships in Phase 7." />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Shop preferences</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : (
            <div>
              <Row label="Currency" value={data.currency} />
              <Row label="Tax rate" value={`${data.tax_rate}%`} />
              <Row label="Low-stock default" value={data.low_stock_default} />
              <Row label="Language" value={data.language} />
              <Row label="Timezone" value={data.timezone} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
