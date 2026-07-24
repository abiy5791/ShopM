import { NavLink } from "react-router-dom";

import { Logo } from "@/components/logo";
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
    <nav className="flex-1 space-y-0.5 px-3 py-3">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "group relative flex items-center gap-3 rounded-md py-2 pl-4 pr-3 text-sm font-medium transition-colors duration-150",
              isActive
                ? "bg-sidebar-accent/15 text-sidebar-foreground"
                : "text-sidebar-foreground/60 hover:bg-sidebar-foreground/[0.06] hover:text-sidebar-foreground",
            )
          }
        >
          {({ isActive }) => (
            <>
              {/* Ledger cursor — the accent bar marks the current line, the way a
                  caret marks a receipt printer's position. */}
              <span
                className={cn(
                  "absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-sidebar-accent transition-opacity duration-150",
                  isActive ? "opacity-100" : "opacity-0",
                )}
              />
              <item.icon
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  isActive
                    ? "text-sidebar-accent"
                    : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80",
                )}
              />
              {item.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

/** The brand mark + wordmark, matched to the login screen so the identity reads
 *  as one continuous product from sign-in through the live app. The logo inherits
 *  the sidebar text color, so it recolors with the light/dark theme. */
export function BrandMark() {
  return (
    <div className="flex h-14 items-center gap-2.5 px-5">
      <Logo className="h-7 w-7 text-sidebar-foreground" />
      <span className="font-mono text-base font-bold tracking-tight">ShopM</span>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="bg-receipt-dots hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <BrandMark />
      <div className="mx-5 border-t border-sidebar-border" />
      <NavLinks />
      <div className="px-5 py-3 font-mono text-[10px] uppercase tracking-widest text-sidebar-foreground/35">
        Offline-ready · v0.1
      </div>
    </aside>
  );
}
