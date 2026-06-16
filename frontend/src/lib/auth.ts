import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { AuthUser, Membership } from "@/types";

interface AuthState {
  access: string | null;
  refresh: string | null;
  user: AuthUser | null;
  /** Memberships from /me — drives the shop switcher and role-aware nav. */
  memberships: Membership[];
  /** The shop currently sent as X-Shop-Id. */
  activeShopId: string | null;

  setSession: (data: { access: string; refresh: string; user: AuthUser }) => void;
  setTokens: (data: { access: string; refresh?: string }) => void;
  setMemberships: (memberships: Membership[]) => void;
  setActiveShop: (shopId: string | null) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      access: null,
      refresh: null,
      user: null,
      memberships: [],
      activeShopId: null,

      setSession: ({ access, refresh, user }) => set({ access, refresh, user }),
      setTokens: ({ access, refresh }) => set({ access, refresh: refresh ?? get().refresh }),
      setMemberships: (memberships) => {
        const current = get().activeShopId;
        const stillValid = memberships.some((m) => m.shop_id === current);
        set({
          memberships,
          activeShopId: stillValid ? current : (memberships[0]?.shop_id ?? null),
        });
      },
      setActiveShop: (shopId) => set({ activeShopId: shopId }),
      clear: () =>
        set({ access: null, refresh: null, user: null, memberships: [], activeShopId: null }),
    }),
    {
      name: "shopm-auth",
      partialize: (s) => ({
        access: s.access,
        refresh: s.refresh,
        user: s.user,
        activeShopId: s.activeShopId,
      }),
    },
  ),
);

export function activeRole(): "owner" | "cashier" | null {
  const { memberships, activeShopId } = useAuthStore.getState();
  return memberships.find((m) => m.shop_id === activeShopId)?.role ?? null;
}
