import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useAuthStore } from "@/lib/auth";
import type { RoleName } from "@/types";

export function useActiveRole(): RoleName | null {
  return useAuthStore((s) => s.memberships.find((m) => m.shop_id === s.activeShopId)?.role ?? null);
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const isAuthed = useAuthStore((s) => Boolean(s.access));
  return isAuthed ? <>{children}</> : <Navigate to="/login" replace />;
}

/** Page-level role gate. The backend is the real enforcer; this just hides UI. */
export function RoleGate({ allow, children }: { allow: RoleName[]; children: ReactNode }) {
  const role = useActiveRole();
  if (role && !allow.includes(role)) {
    return (
      <div className="mx-auto max-w-md rounded-lg border bg-card p-8 text-center">
        <h2 className="text-lg font-semibold">Not available</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your role doesn&apos;t have access to this section in the current shop.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
