import { useQuery } from "@tanstack/react-query";

import type { KpiSummary } from "@/components/kpi";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";

/**
 * The KPI cards shown above a list table (`GET /<resource>/summary`).
 *
 * The query key is prefixed with the resource name on purpose: the mutations
 * that already invalidate `["products"]`, `["sales"]`, … refresh these figures
 * too, so a card never contradicts the rows underneath it.
 *
 * Pass `enabled: false` where the endpoint is owner-only — a cashier would get
 * a 403 and the row simply doesn't render.
 */
export function useSummary(resource: string, enabled = true) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: [resource, "summary", activeShopId],
    enabled: Boolean(activeShopId) && enabled,
    queryFn: async () => (await api.get<KpiSummary>(`/${resource}/summary`)).data,
    staleTime: 30_000,
  });
}
