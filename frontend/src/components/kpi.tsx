/**
 * The KPI tile and the card row that sits above every list table.
 *
 * The visual language is the receipt's own: an uppercase mono micro-label
 * (SUBTOTAL / CASH / CHANGE), a big tabular figure, and a quiet hint line —
 * so a stat row reads like a line off the printer. Dashboard tiles and page
 * summary rows share this one implementation.
 */

import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Boxes,
  CalendarClock,
  CreditCard,
  Factory,
  HandCoins,
  History,
  Layers,
  Minus,
  Package,
  PackageX,
  Receipt,
  Repeat,
  ShieldAlert,
  ShoppingCart,
  Tag,
  Truck,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Colours the figure: a warning is not an error, just something to look at. */
export type KpiTone = "default" | "positive" | "negative" | "warning";

export interface KpiDelta {
  current: number;
  previous: number;
  label?: string;
}

/** One card as the server sends it (see apps/reports/summaries.py). */
export interface KpiCard {
  key: string;
  label: string;
  value: number;
  /** Integer minor units when true — format with the shop's currency. */
  money: boolean;
  hint?: string;
  tone?: KpiTone;
  delta?: KpiDelta | null;
}

export interface KpiSummary {
  currency: string;
  cards: KpiCard[];
}

/** Card key → icon. Keys are stable server-side; anything new falls back. */
const ICONS: Record<string, LucideIcon> = {
  // products
  products: Package,
  low_stock: PackageX,
  stock_value: Boxes,
  retail_value: Tag,
  out_of_stock: PackageX,
  units: Boxes,
  // sales (shop-wide for owners, own-till for cashiers)
  today: Receipt,
  month: CalendarClock,
  avg_sale: TrendingUp,
  on_credit: CreditCard,
  items_today: Package,
  week_takings: CalendarClock,
  // customers
  customers: Users,
  credit: CreditCard,
  largest_balance: HandCoins,
  settled: Wallet,
  // purchases & suppliers
  month_spend: ShoppingCart,
  paid: Banknote,
  outstanding: HandCoins,
  top_supplier: Truck,
  suppliers: Factory,
  payable: HandCoins,
  biggest_supplier: Truck,
  // expenses
  per_day: CalendarClock,
  top_category: Layers,
  recurring: Repeat,
  // activity
  events_today: History,
  events_week: Activity,
  flagged: ShieldAlert,
  active_staff: UserPlus,
};

const TONE_CLASS: Record<KpiTone, string> = {
  default: "",
  positive: "text-accent",
  negative: "text-destructive",
  warning: "text-destructive",
};

export function Kpi({
  label,
  icon: Icon,
  value,
  sub,
  loading,
  delta,
  tone = "default",
  compact = false,
}: {
  label: string;
  icon: LucideIcon;
  value?: string;
  sub?: ReactNode;
  loading?: boolean;
  delta?: ReactNode;
  tone?: KpiTone;
  /** Two tiles per row on phones (the list-page row) rather than one — the
   *  figure steps down a size so a long money value still fits half a screen. */
  compact?: boolean;
}) {
  return (
    <Card className={compact ? "p-4 sm:p-5" : "p-5"}>
      <div className="flex items-center justify-between gap-2">
        {/* title: the label truncates in a half-width tile on phones. */}
        <span
          title={label}
          className="truncate font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground"
        >
          {label}
        </span>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {loading || value === undefined ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <div
          className={cn(
            "mt-3 font-mono font-semibold leading-none tabular-nums",
            compact ? "text-lg sm:text-[26px]" : "text-[26px]",
            TONE_CLASS[tone],
          )}
        >
          {value}
        </div>
      )}
      {(sub || delta) && (
        <div className="mt-2 flex min-w-0 items-center gap-2">
          {delta}
          {/* Wraps rather than truncates — a hint like "cash received − expenses
              & purchases" is the whole point of the line. Grid rows stretch to
              the tallest tile, so a second line costs nothing. */}
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      )}
    </Card>
  );
}

/** A trend chip in the PNL style: green up / red down / muted flat, with the
 *  period-over-period change. Shows only real comparisons — no baseline yet
 *  reads as "New", equal reads flat. */
export function DeltaBadge({
  current,
  previous,
  label,
}: {
  current: number;
  previous: number;
  label?: string;
}) {
  let dir: "up" | "down" | "flat" = "flat";
  let text = "—";
  if (previous === 0) {
    if (current > 0) {
      dir = "up";
      text = "New";
    }
  } else {
    const pct = ((current - previous) / previous) * 100;
    dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
    const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
    text = `${pct > 0 ? "+" : ""}${rounded}%`;
  }
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  const tone =
    dir === "up"
      ? "bg-accent/10 text-accent"
      : dir === "down"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";
  return (
    <span
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums",
        tone,
      )}
    >
      <Icon className="h-3 w-3" />
      {text}
    </span>
  );
}

/**
 * The four-up KPI row above a list table. Renders skeleton tiles while the
 * summary loads and nothing at all if it fails — a page's stats are a bonus,
 * never a reason to hide the table below them.
 */
export function KpiRow({
  summary,
  loading = false,
  className,
}: {
  summary?: KpiSummary;
  loading?: boolean;
  className?: string;
}) {
  if (!summary && !loading) return null;
  const cards = summary?.cards ?? [];
  const tiles = cards.length > 0 ? cards : PLACEHOLDERS;

  return (
    <div className={cn("mb-4 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4", className)}>
      {tiles.map((card) => (
        <Kpi
          key={card.key}
          compact
          label={card.label}
          icon={ICONS[card.key] ?? AlertTriangle}
          loading={loading || cards.length === 0}
          tone={card.tone ?? "default"}
          value={
            card.money
              ? formatMoney(card.value, summary?.currency ?? "ETB")
              : formatCount(card.value)
          }
          sub={card.hint}
          delta={
            card.delta ? (
              <DeltaBadge
                current={card.delta.current}
                previous={card.delta.previous}
                label={card.delta.label}
              />
            ) : undefined
          }
        />
      ))}
    </div>
  );
}

/** Plain counts get thousands separators; money goes through formatMoney. */
function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/** Four blank tiles so the row reserves its space on first load. */
const PLACEHOLDERS: KpiCard[] = [0, 1, 2, 3].map((i) => ({
  key: `placeholder-${i}`,
  label: "",
  value: 0,
  money: false,
}));
