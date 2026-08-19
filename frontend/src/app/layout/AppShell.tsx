import { useState } from "react";
import Headroom from "react-headroom";
import { Outlet } from "react-router-dom";

import { ThemeToggle } from "@/components/theme-toggle";
import { useMe } from "@/features/auth/api";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { useAuthStore } from "@/lib/auth";
import { useApplyTheme } from "@/lib/theme";

import { MobileNav } from "./MobileNav";
import { ShopSwitcher } from "./ShopSwitcher";
import { Sidebar } from "./Sidebar";
import { UserMenu } from "./UserMenu";

export function AppShell() {
  const isAuthed = useAuthStore((s) => Boolean(s.access));
  // Load profile + memberships into the store (drives nav + shop switcher).
  useMe(isAuthed);
  useApplyTheme();

  // The content column is the scroll container; Headroom watches it so the top
  // bar slides away on scroll-down and returns on scroll-up. We hold the element
  // in state via a callback ref and only mount Headroom once it exists — its
  // parent() is read during mount, and a bare ref isn't attached yet then.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  const headerBar = (
    <header className="flex h-14 items-center justify-between gap-2 border-b bg-card/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/70">
      {/* `min-w-0` lets the shop name truncate instead of growing the row, and
          `shrink-0` keeps the actions anchored. Without both, a long shop name
          pushes the account menu off the right edge of a phone — it is still in
          the DOM and still "visible", just past the screen. */}
      <div className="flex min-w-0 items-center gap-1">
        <MobileNav />
        <ShopSwitcher />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );

  return (
    <div className="flex h-full">
      <Sidebar />
      <div
        ref={setScrollEl}
        className="relative flex flex-1 flex-col overflow-y-auto bg-background"
      >
        {scrollEl ? (
          <Headroom parent={() => scrollEl} className="app-headroom">
            {headerBar}
          </Headroom>
        ) : (
          headerBar
        )}
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
