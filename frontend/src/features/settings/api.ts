import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { ShopSettings } from "@/types";

export function useSettings() {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["settings", activeShopId],
    enabled: Boolean(activeShopId),
    queryFn: async () => (await api.get<ShopSettings>("/settings")).data,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<ShopSettings>) =>
      (await api.patch<ShopSettings>("/settings", patch)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["shops"] }); // currency/tax feed other pages
    },
  });
}
