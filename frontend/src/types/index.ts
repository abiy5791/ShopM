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

export interface StaffMembership {
  id: string;
  shop_id: string;
  shop_name: string;
  role: RoleName;
}

export interface StaffMember {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
  memberships: StaffMembership[];
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
  // Integer minor units (plan §3.5) — what the shop owes this supplier.
  payable_cached: number;
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

export type PaymentMethod = "cash" | "telebirr" | "cbe" | "abyssinia" | "bank" | "mobile_money";

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
  customer?: string;
  /**
   * The day the sale happened, "YYYY-MM-DD", when that isn't today — an owner
   * recording a day that was missed. Owner-only and bounded by the server
   * (GET /sales/date-window); omit it for a normal sale.
   */
  sale_date?: string;
}

/** One recorded correction to a sale. Append-only — amendments never change. */
export interface SaleAmendment {
  id: string;
  reason: string;
  changes: { field: string; from: string; to: string }[];
  before: SaleSnapshot;
  after: SaleSnapshot;
  user_email: string | null;
  user_name: string | null;
  created_at: string;
}

/** The state of a sale either side of a correction, kept for the audit trail. */
export interface SaleSnapshot {
  occurred_at: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  notes: string;
  customer_id: string | null;
  customer_name: string | null;
  items: {
    product_id: string;
    name: string;
    sku: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }[];
  payments: { method: PaymentMethod; amount: number }[];
}

/**
 * An owner's correction to a mis-recorded sale (PATCH /sales/{id}). Only the
 * fields sent are changed; `reason` is always required, and sending `items` or
 * `payments` replaces that whole list.
 */
export interface SaleEditPayload {
  reason: string;
  items?: SaleItemInput[];
  payments?: PaymentInput[];
  customer?: string | null;
  discount?: number;
  tax?: number;
  notes?: string;
  sale_date?: string;
}

/** The window a sale may be dated to, and whether this member may use it. */
export interface SaleDateWindow {
  earliest: string;
  latest: string;
  max_days: number;
  allowed: boolean;
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
  customer: string | null;
  customer_name: string | null;
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
  /** When the sale happened — the day it counts towards in every report. */
  occurred_at: string;
  /** True when it was entered on a later day than it is booked to. */
  is_backdated: boolean;
  /** When the sale was last corrected, or null if it never has been. */
  amended_at: string | null;
  is_amended: boolean;
  /** Correction history, newest first. Empty for almost every sale. */
  amendments: SaleAmendment[];
  /** When the row was entered. Differs from occurred_at only for a backdate. */
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
  /** Set when the sale is booked to an earlier day than it was entered. */
  is_backdated?: boolean;
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

export type ExpenseRecurrence = "one_time" | "monthly";

export interface Expense {
  id: string;
  category: string | null;
  category_name: string | null;
  amount: number;
  recurrence: ExpenseRecurrence;
  date: string;
  description: string;
  receipt_image_url: string | null;
  created_at: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  credit_balance_cached: number;
  created_at: string;
}

export interface CustomerLedger {
  customer_id: string;
  balance: number;
  sales: { id: string; total: number; status: string; occurred_at: string }[];
  payments: {
    id: string;
    method: PaymentMethod;
    amount: number;
    sale: string | null;
    received_at: string;
  }[];
}

export interface DashboardData {
  currency: string;
  date?: string;
  week_series?: { date: string; total: number }[];
  today: {
    sales_total: number;
    sales_count: number;
    expenses_total: number;
    gross_profit: number;
    net_profit: number;
  };
  low_stock_count: number;
  total_products: number;
  cash_balance: number;
  best_sellers: { name: string; quantity: number }[];
  recent_sales: { id: string; total: number; occurred_at: string }[];
}

/** A cashier's own day (GET /shift): their till, plus counter-side shelf facts.
 *  Deliberately carries no shop profit, valuation or cash position. */
export interface ShiftData {
  currency: string;
  date: string;
  date_ethiopian: string;
  today: {
    sales_total: number;
    sales_count: number;
    items_sold: number;
    avg_sale: number;
    yesterday_total: number;
  };
  week_series: { date: string; total: number; count: number }[];
  top_products: { name: string; quantity: number }[];
  recent_sales: {
    id: string;
    occurred_at: string;
    total: number;
    item_count: number;
    customer_name: string | null;
  }[];
  low_stock: { name: string; sku: string; stock: number }[];
  low_stock_count: number;
  debtor_count: number;
  top_debtors: { name: string; balance: number }[];
}

export interface DayBookData {
  date: string;
  date_ethiopian: string;
  currency: string;
  summary: {
    sales_total: number;
    net_sales: number;
    tax_total: number;
    sales_count: number;
    items_sold: number;
    gross_profit: number;
    expenses_total: number;
    direct_expenses: number;
    monthly_prorated: number;
    monthly_full: number;
    net_profit: number;
    cash_received: number;
    settlements_received: number;
    discount_total: number;
  };
  by_method: { method: PaymentMethod; total: number }[];
  top_products: { name: string; quantity: number; revenue: number }[];
  sales: {
    id: string;
    occurred_at: string;
    total: number;
    item_count: number;
    cashier_name: string;
    customer_name: string | null;
  }[];
  expenses: { category: string; description: string; amount: number }[];
  monthly_expenses: {
    category: string;
    description: string;
    amount: number;
    per_day: number;
  }[];
  activity: {
    created_at: string;
    action: string;
    user_email: string | null;
    level: "info" | "warn" | "critical";
  }[];
}

export interface ReportSummaryItem {
  label: string;
  value: number;
  money: boolean;
}

export interface SalesSeriesPoint {
  date: string;
  /** Ethiopian bucket label — matches the table row's first cell. */
  label?: string;
  total: number;
  count: number;
  start?: string; // Gregorian ISO — the bucket's first day (for drill-down)
  end?: string; // Gregorian ISO — the bucket's last day
}

export interface ProfitSeriesPoint {
  date: string;
  revenue: number;
  cogs: number;
  expenses: number;
  net: number;
}

export interface CashflowSeriesPoint {
  date: string;
  cash_in: number;
  cash_out: number;
  net: number;
  balance: number;
}

export interface ReportData {
  key: string;
  title: string;
  currency: string;
  summary: ReportSummaryItem[];
  columns: string[];
  rows: (string | number)[][];
  money_columns: number[];
  period?: { start: string; end: string; granularity?: string };
  // Chart payloads (v2 plan §4) — present per report type.
  series?: (SalesSeriesPoint | ProfitSeriesPoint | CashflowSeriesPoint)[];
  by_method?: { method: PaymentMethod; total: number }[];
  /** Sales billed but not yet collected (credit) — payments + this = total sales. */
  unpaid_credit?: number;
  by_category?: { category: string; total: number }[];
  top_sellers?: { name: string; quantity: number }[];
  stock_value?: {
    at_cost: number;
    expected_sales: number;
    potential_profit: number;
    tax_rate: number;
    expected_tax: number;
    total_if_sold: number;
  };
}

export interface OwnerShopSummary extends DashboardData {
  shop_id: string;
  shop_name: string;
}

export interface OwnerDashboardData {
  shop_count: number;
  shops: OwnerShopSummary[];
  low_stock_alerts: {
    shop_name: string;
    product: string;
    sku: string;
    stock: number;
    min_alert: number;
  }[];
  recent_expenses: {
    shop_name: string;
    amount: number;
    currency: string;
    category: string | null;
    by: string | null;
    date: string;
  }[];
  stock_movements: {
    shop_name: string;
    product: string;
    type: TransactionType;
    quantity: number;
    at: string;
  }[];
}

export interface ShopComparisonRow {
  shop_id: string;
  shop_name: string;
  currency: string;
  sales_total: number;
  sales_count: number;
  gross_profit: number;
  expenses: number;
  net_profit: number;
  rank: number;
}

export interface ShopComparison {
  period: { start: string; end: string };
  shops: ShopComparisonRow[];
}

export type NotificationType =
  | "low_stock"
  | "out_of_stock"
  | "large_expense"
  | "large_void"
  | "failed_login"
  | "daily_summary";

export interface AppNotification {
  id: string;
  type: NotificationType;
  level: "info" | "warn" | "critical";
  title: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  is_read: boolean;
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
