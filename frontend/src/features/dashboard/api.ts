import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { DashboardData } from "@/types";

export function useDashboard(enabled: boolean) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["dashboard", activeShopId],
    enabled: enabled && Boolean(activeShopId),
    queryFn: async () => (await api.get<DashboardData>("/dashboard")).data,
  });
}
