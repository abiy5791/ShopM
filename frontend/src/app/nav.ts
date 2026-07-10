import {
  BarChart3,
  Building2,
  ClipboardList,
  LayoutDashboard,
  Package,
  Receipt,
  ScanLine,
  ScrollText,
  Settings,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { RoleName } from "@/types";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Roles allowed to see this item. Undefined = all roles. */
  roles?: RoleName[];
  /** Phase that ships this section (shown as a hint on placeholder pages). */
  phase?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, phase: 5 },
  { to: "/pos", label: "Point of Sale", icon: ScanLine, roles: ["owner", "cashier"], phase: 2 },
  { to: "/sales", label: "Sales", icon: ClipboardList, roles: ["owner", "cashier"], phase: 8 },
  { to: "/products", label: "Products", icon: Package, phase: 1 },
  { to: "/customers", label: "Customers", icon: Users, roles: ["owner", "cashier"], phase: 4 },
  { to: "/purchases", label: "Purchases", icon: Truck, roles: ["owner"], phase: 3 },
  { to: "/expenses", label: "Expenses", icon: Receipt, roles: ["owner"], phase: 3 },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["owner"], phase: 5 },
  { to: "/console", label: "Owner console", icon: Building2, roles: ["owner"], phase: 6 },
  { to: "/activity", label: "Activity", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["owner"], phase: 7 },
];

export function visibleNav(role: RoleName | null): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || (role !== null && item.roles.includes(role)));
}
