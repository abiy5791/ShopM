import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { OwnerDashboardData, ShopComparison } from "@/types";

// Owner-wide endpoints ignore X-Shop-Id (plan §3.1); the interceptor may still
// send it — the backend simply doesn't use it under /owner/.

export function useOwnerDashboard() {
  return useQuery({
    queryKey: ["owner-dashboard"],
    queryFn: async () => (await api.get<OwnerDashboardData>("/owner/dashboard")).data,
  });
}

export function useShopComparison(start?: string, end?: string) {
  return useQuery({
    queryKey: ["owner-compare", start, end],
    queryFn: async () =>
      (
        await api.get<ShopComparison>("/owner/shops/compare", {
          params: { start: start || undefined, end: end || undefined },
        })
      ).data,
  });
}
