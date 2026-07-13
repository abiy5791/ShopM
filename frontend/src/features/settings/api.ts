import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import type { Paginated, Shop, ShopSettings, StaffMember } from "@/types";

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

// ------------------------------------------------------------ branches (v2 §3)
export function useShops() {
  return useQuery({
    queryKey: ["shops"],
    queryFn: async () => (await api.get<Paginated<Shop>>("/shops")).data.results,
  });
}

function invalidateShopScope(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["shops"] });
  qc.invalidateQueries({ queryKey: ["me"] }); // memberships drive the shop switcher
}

export function useCreateShop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; address?: string; phone?: string }) =>
      (await api.post<Shop>("/shops", body)).data,
    onSuccess: () => invalidateShopScope(qc),
  });
}

export function useUpdateShop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      address?: string;
      phone?: string;
    }) => (await api.patch<Shop>(`/shops/${id}`, patch)).data,
    onSuccess: () => invalidateShopScope(qc),
  });
}

export function useArchiveShop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/shops/${id}`),
    onSuccess: () => invalidateShopScope(qc),
  });
}

// --------------------------------------------------------------- staff (v2 §3)
export interface StaffCreatePayload {
  full_name: string;
  email: string;
  password: string;
  memberships: { shop: string; role: "owner" | "cashier" }[];
}

export interface StaffUpdatePayload {
  full_name?: string;
  email?: string;
  is_active?: boolean;
  password?: string;
}

export function useStaff(search: string) {
  return useQuery({
    queryKey: ["staff", search],
    queryFn: async () =>
      (await api.get<Paginated<StaffMember>>("/staff", { params: { search } })).data,
  });
}

export function useCreateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: StaffCreatePayload) =>
      (await api.post<StaffMember>("/staff", body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useUpdateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: StaffUpdatePayload & { id: string }) =>
      (await api.patch<StaffMember>(`/staff/${id}`, patch)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useAddStaffMembership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      staffId,
      shop,
      role,
    }: {
      staffId: string;
      shop: string;
      role: "owner" | "cashier";
    }) => (await api.post<StaffMember>(`/staff/${staffId}/memberships`, { shop, role })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
}

export function useRemoveStaffMembership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ staffId, membershipId }: { staffId: string; membershipId: string }) =>
      (await api.delete<StaffMember>(`/staff/${staffId}/memberships/${membershipId}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff"] }),
  });
}
