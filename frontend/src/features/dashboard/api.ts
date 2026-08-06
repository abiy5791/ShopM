import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { DashboardData, ShiftData } from "@/types";

export function useDashboard(enabled: boolean) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["dashboard", activeShopId],
    enabled: enabled && Boolean(activeShopId),
    queryFn: async () => (await api.get<DashboardData>("/dashboard")).data,
  });
}

/**
 * The signed-in user's own day. Any member may call it — it's their till, not
 * the shop's books — so it powers the cashier dashboard.
 *
 * Keyed under "sales" as well as "shift" so ringing up or voiding a sale, which
 * already invalidates `["sales"]`, refreshes the shift figures with it.
 */
export function useShift(enabled: boolean) {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["sales", "shift", activeShopId],
    enabled: enabled && Boolean(activeShopId),
    queryFn: async () => (await api.get<ShiftData>("/shift")).data,
  });
}
