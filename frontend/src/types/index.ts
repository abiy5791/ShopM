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
  currency: string;
  tax_rate: string;
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

export interface Category {
  id: string;
  name: string;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  created_at: string;
}

export type ProductStatus = "active" | "inactive";

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  category: string | null;
  category_name: string | null;
  supplier: string | null;
  supplier_name: string | null;
  // Integer minor units (plan §3.5) — format with formatMoney at the display edge.
  purchase_price: number;
  selling_price: number;
  unit: string;
  min_stock_alert: number;
  status: ProductStatus;
  stock_cached: number;
  is_low_stock: boolean;
  created_at: string;
  updated_at: string;
}

export type AdjustmentType = "adjustment" | "damage" | "expiry" | "return_in" | "return_out";

export type TransactionType = AdjustmentType | "purchase" | "sale" | "reconcile";

export interface InventoryTransaction {
  id: string;
  product: string;
  product_name: string;
  product_sku: string;
  quantity: number;
  type: TransactionType;
  unit_cost: number | null;
  reference_type: string;
  reference_id: string;
  user: string | null;
  user_email: string | null;
  notes: string;
  created_at: string;
}

export type PaymentMethod = "cash" | "bank" | "mobile_money";

export interface SaleItemInput {
  product: string;
  quantity: number;
  unit_price?: number;
}

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
}

export interface SalePayload {
  client_uuid: string;
  items: SaleItemInput[];
  payments: PaymentInput[];
  discount: number;
  tax: number;
  notes?: string;
}

export interface SaleItem {
  id: string;
  product: string;
  name_snapshot: string;
  sku_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  line_total: number;
}

export interface SalePayment {
  id: string;
  method: PaymentMethod;
  amount: number;
  received_at: string;
}

export interface Sale {
  id: string;
  client_uuid: string;
  cashier: string;
  cashier_email: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  status: "completed" | "voided";
  notes: string;
  amount_paid: number;
  change: number;
  items: SaleItem[];
  payments: SalePayment[];
  voided_at: string | null;
  created_at: string;
}

/**
 * Normalised receipt shape used by the printable component. Built either from a
 * server response or, for an offline sale, from the local cart snapshot.
 */
export interface ReceiptData {
  shop_name: string;
  shop_address?: string;
  cashier_name: string;
  currency: string;
  receipt_footer?: string;
  created_at: string;
  items: { name: string; quantity: number; unit_price: number; line_total: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  amount_paid: number;
  change: number;
  offline: boolean;
}

export type PaymentStatus = "paid" | "partial" | "unpaid";

export interface PurchaseItem {
  id: string;
  product: string;
  product_name: string;
  product_sku: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
}

export interface Purchase {
  id: string;
  supplier: string | null;
  supplier_name: string | null;
  total: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  date: string;
  notes: string;
  items: PurchaseItem[];
  created_at: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  created_at: string;
}

export interface Expense {
  id: string;
  category: string | null;
  category_name: string | null;
  amount: number;
  date: string;
  description: string;
  receipt_image_url: string | null;
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
