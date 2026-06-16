/**
 * Domain types used by the app shell.
 *
 * NOTE (plan §9, §12): the full API surface is generated from the backend's
 * OpenAPI schema via `npm run gen:types` into `src/types/api.ts`. As we add
 * resources (Phase 1+), prefer the generated `components["schemas"][...]`
 * types over hand-written ones. These few are declared here so the Phase 0
 * shell type-checks before the first generation run.
 */

export type RoleName = "owner" | "cashier";

export interface Membership {
  shop_id: string;
  shop_name: string;
  role: RoleName;
}

export interface Me {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_staff: boolean;
  memberships: Membership[];
}

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  user: AuthUser;
}

export interface Shop {
  id: string;
  name: string;
  address: string;
  phone: string;
  my_role: RoleName | null;
  created_at: string;
}

export interface ShopSettings {
  currency: string;
  tax_rate: string;
  logo_url: string;
  receipt_footer: string;
  low_stock_default: number;
  language: string;
  timezone: string;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  level: "info" | "warn" | "critical";
  metadata: Record<string, unknown>;
  ip: string | null;
  user: string | null;
  user_email: string | null;
  created_at: string;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ApiError {
  detail: string;
  code: string;
  fields: Record<string, string[]>;
}
