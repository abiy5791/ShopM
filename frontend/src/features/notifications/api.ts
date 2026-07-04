import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { AppNotification, Paginated } from "@/types";

export function useNotifications() {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["notifications", activeShopId],
    enabled: Boolean(activeShopId),
    refetchInterval: 60_000,
    queryFn: async () => (await api.get<Paginated<AppNotification>>("/notifications")).data.results,
  });
}

export function useUnreadCount() {
  const activeShopId = useAuthStore((s) => s.activeShopId);
  return useQuery({
    queryKey: ["notifications-unread", activeShopId],
    enabled: Boolean(activeShopId),
    refetchInterval: 60_000,
    queryFn: async () =>
      (await api.get<{ unread: number }>("/notifications/unread-count")).data.unread,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["notifications-unread"] });
  };
  const markOne = useMutation({
    mutationFn: async (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: invalidate,
  });
  const markAll = useMutation({
    mutationFn: async () => api.post("/notifications/read-all"),
    onSuccess: invalidate,
  });
  return { markOne, markAll };
}
