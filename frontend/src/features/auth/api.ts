import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import type { LoginResponse, Me } from "@/types";

export function useMe(enabled: boolean) {
  return useQuery({
    queryKey: ["me"],
    enabled,
    queryFn: async () => {
      const { data } = await api.get<Me>("/me");
      useAuthStore.getState().setMemberships(data.memberships);
      return data;
    },
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: async (creds: { email: string; password: string }) => {
      const { data } = await api.post<LoginResponse>("/auth/login", creds);
      return data;
    },
    onSuccess: (data) => {
      useAuthStore.getState().setSession(data);
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      const refresh = useAuthStore.getState().refresh;
      if (refresh) {
        try {
          await api.post("/auth/logout", { refresh });
        } catch {
          // Best-effort; we clear local state regardless.
        }
      }
    },
    onSettled: () => {
      useAuthStore.getState().clear();
      queryClient.clear();
    },
  });
}
