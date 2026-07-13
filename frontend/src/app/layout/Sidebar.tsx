import { Store } from "lucide-react";
import { NavLink } from "react-router-dom";

import { useAuthStore } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { RoleName } from "@/types";

import { visibleNav } from "../nav";

/** Role-filtered nav links, shared by the desktop sidebar and mobile drawer. */
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { memberships, activeShopId } = useAuthStore();
  const role: RoleName | null = memberships.find((m) => m.shop_id === activeShopId)?.role ?? null;
  const items = visibleNav(role);

  return (
    <nav className="flex-1 space-y-1 px-3 py-2">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150",
              isActive
                ? "bg-sidebar-accent text-white"
                : "text-sidebar-foreground/70 hover:bg-white/5 hover:text-sidebar-foreground",
            )
          }
        >
          <item.icon className="h-4 w-4 shrink-0" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function BrandMark() {
  return (
    <div className="flex h-14 items-center gap-2 px-5 text-base font-semibold">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-sidebar-accent text-white">
        <Store className="h-4 w-4" />
      </span>
      ShopM
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
      <BrandMark />
      <NavLinks />
      <div className="px-5 py-3 text-xs text-sidebar-foreground/40">ShopM v0.1</div>
    </aside>
  );
}
