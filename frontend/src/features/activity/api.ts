import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { ActivityLog, Paginated } from "@/types";

export interface ActivityFilters {
  search?: string;
  level?: string;
  created_after?: string;
  created_before?: string;
  page?: number;
}

export function useActivity(filters: ActivityFilters) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["activity", activeShopId, filters],
    enabled: Boolean(activeShopId),
    queryFn: async () => {
      const res = await api.get<Paginated<ActivityLog>>("/activity", {
        params: {
          search: filters.search || undefined,
          level: filters.level || undefined,
          created_after: filters.created_after ? `${filters.created_after}T00:00:00Z` : undefined,
          created_before: filters.created_before
            ? `${filters.created_before}T23:59:59Z`
            : undefined,
          page: filters.page,
        },
      });
      return res.data;
    },
  });
}
