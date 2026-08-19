import { Check, ChevronsUpDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function ShopSwitcher() {
  const { memberships, activeShopId, setActiveShop } = useAuthStore();
  const active = memberships.find((m) => m.shop_id === activeShopId);

  if (memberships.length === 0) {
    return <span className="text-sm text-muted-foreground">No shops</span>;
  }

  // A single shop needs no switcher — just show it.
  if (memberships.length === 1) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">{active?.shop_name}</span>
        {active && (
          <Badge variant="secondary" className="shrink-0">
            {active.role}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="min-w-0 gap-2">
          <span className="truncate">{active?.shop_name ?? "Select shop"}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Switch shop</DropdownMenuLabel>
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.shop_id}
            onSelect={() => setActiveShop(m.shop_id)}
            className="justify-between"
          >
            <span className="flex items-center gap-2">
              <Check
                className={cn("h-4 w-4", m.shop_id === activeShopId ? "opacity-100" : "opacity-0")}
              />
              {m.shop_name}
            </span>
            <Badge variant="secondary">{m.role}</Badge>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
