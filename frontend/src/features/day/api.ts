import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { DayBookData } from "@/types";

/** GET /reports/day?date= — one day's full close for the active shop (owner only). */
export function useDayBook(date: string, enabled: boolean) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["day-book", activeShopId, date],
    enabled: enabled && Boolean(activeShopId),
    queryFn: async () =>
      (await api.get<DayBookData>("/reports/day", { params: { date } })).data,
  });
}
