import { AlertTriangle, Bell, CheckCheck, Info, PackageX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AppNotification, NotificationType } from "@/types";

import { useMarkRead, useNotifications, useUnreadCount } from "./api";

const ICONS: Record<NotificationType, typeof Bell> = {
  low_stock: AlertTriangle,
  out_of_stock: PackageX,
  large_expense: AlertTriangle,
  large_void: AlertTriangle,
  failed_login: AlertTriangle,
  daily_summary: Info,
};

export function NotificationBell() {
  const { data: notifications } = useNotifications();
  const { data: unread = 0 } = useUnreadCount();
  const { markOne, markAll } = useMarkRead();

  const rows = notifications ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-accent hover:underline"
              onClick={() => markAll.mutate()}
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              You're all caught up.
            </p>
          ) : (
            rows.map((n) => <Row key={n.id} n={n} onRead={() => markOne.mutate(n.id)} />)
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Row({ n, onRead }: { n: AppNotification; onRead: () => void }) {
  const Icon = ICONS[n.type] ?? Info;
  const tone =
    n.level === "critical"
      ? "text-destructive"
      : n.level === "warn"
        ? "text-secondary-foreground"
        : "text-muted-foreground";
  return (
    <button
      type="button"
      onClick={() => !n.is_read && onRead()}
      className={
        "flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-muted/40 " +
        (n.is_read ? "opacity-60" : "")
      }
    >
      <Icon className={"mt-0.5 h-4 w-4 shrink-0 " + tone} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">{n.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {new Date(n.created_at).toLocaleString()}
        </p>
      </div>
      {!n.is_read && <Badge variant="accent" className="h-1.5 w-1.5 shrink-0 rounded-full p-0" />}
    </button>
  );
}
