import { Outlet } from "react-router-dom";

import { ThemeToggle } from "@/components/theme-toggle";
import { useMe } from "@/features/auth/api";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { useAuthStore } from "@/lib/auth";
import { useApplyTheme } from "@/lib/theme";

import { ShopSwitcher } from "./ShopSwitcher";
import { Sidebar } from "./Sidebar";
import { UserMenu } from "./UserMenu";

export function AppShell() {
  const isAuthed = useAuthStore((s) => Boolean(s.access));
  // Load profile + memberships into the store (drives nav + shop switcher).
  useMe(isAuthed);
  useApplyTheme();

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4">
          <ShopSwitcher />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 overflow-auto bg-background p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
