/**
 * Shared chart layer (v2 plan §4), built on Recharts.
 *
 * Series colors come from the CVD-validated `--chart-*` CSS variables
 * (index.css), so charts restyle automatically in dark mode. Money values are
 * integer minor units everywhere; they are formatted only at the display edge
 * (axis ticks compact, tooltips exact) — mirroring the rest of the app.
 */
import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatEthiopianShort } from "@/lib/ethiopian";
import { formatMoney, formatMoneyCompact } from "@/lib/money";

export const CHART_COLORS = [
  "var(--chart-1)", // money in / revenue
  "var(--chart-2)", // money out / costs
  "var(--chart-3)", // net / balance
  "var(--chart-4)", // tertiary
];

const AXIS_TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const GRID_STROKE = "hsl(var(--border))";

function shortDate(value: string): string {
  // Plain ISO dates (daily/weekly buckets) render as a short Ethiopian date
  // ("Hamle 20"); anything else is already an Ethiopian label (e.g. monthly
  // "Hamle 2018", yearly "2018 E.C.") and passes through unchanged.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatEthiopianShort(value) : value;
}

/** Theme-aware tooltip: exact money values, one row per series. */
function MoneyTooltip({
  active,
  payload,
  label,
  currency,
  countKeys = [],
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string;
  currency: string;
  /** dataKeys whose values are plain counts, not money */
  countKeys?: string[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      {label !== undefined && <p className="mb-1 font-medium">{shortDate(String(label))}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-1.5 tabular-nums">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-mono font-medium">
            {countKeys.includes(String(entry.name))
              ? entry.value
              : formatMoney(Number(entry.value ?? 0), currency)}
          </span>
        </p>
      ))}
    </div>
  );
}

function EmptyChart({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center text-sm text-muted-foreground"
      style={{ height }}
    >
      No data for this period.
    </div>
  );
}

// ---------------------------------------------------------------- trend area
/** Single money series over time (no legend — the card title names it). */
export function TrendAreaChart({
  data,
  dataKey,
  name,
  currency,
  height = 260,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  name: string;
  currency: string;
  height?: number;
}) {
  if (!data.length) return <EmptyChart height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={shortDate}
        />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => formatMoneyCompact(v, currency)}
        />
        <Tooltip content={<MoneyTooltip currency={currency} countKeys={["Transactions"]} />} />
        <Area
          type="monotone"
          dataKey={dataKey}
          name={name}
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#trendFill)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------- multi line
/** Several money series on one time axis (e.g. revenue / expenses / net). */
export function MultiLineChart({
  data,
  series,
  currency,
  height = 260,
}: {
  data: Record<string, unknown>[];
  series: { dataKey: string; name: string; color: string }[];
  currency: string;
  height?: number;
}) {
  if (!data.length) return <EmptyChart height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={shortDate}
        />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => formatMoneyCompact(v, currency)}
        />
        <Tooltip content={<MoneyTooltip currency={currency} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
        {series.map((s) => (
          <Line
            key={s.dataKey}
            type="monotone"
            dataKey={s.dataKey}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------- cash flow
/** In/out bars with a running balance line — all money, one axis. */
export function CashflowChart({
  data,
  currency,
  height = 280,
}: {
  data: Record<string, unknown>[];
  currency: string;
  height?: number;
}) {
  if (!data.length) return <EmptyChart height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} barGap={2}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={shortDate}
        />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => formatMoneyCompact(v, currency)}
        />
        <Tooltip content={<MoneyTooltip currency={currency} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar
          dataKey="cash_in"
          name="Cash in"
          fill="var(--chart-1)"
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
        />
        <Bar
          dataKey="cash_out"
          name="Cash out"
          fill="var(--chart-2)"
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
        />
        <Line
          type="monotone"
          dataKey="balance"
          name="Running balance"
          stroke="var(--chart-3)"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ------------------------------------------------------------ horizontal bar
/** Magnitude ranking (top sellers): one hue, value labels at the bar end. */
export function HBarChart({
  data,
  dataKey,
  nameKey,
  name,
  height = 260,
  money,
  currency = "",
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  nameKey: string;
  name: string;
  height?: number;
  money?: boolean;
  currency?: string;
}) {
  if (!data.length) return <EmptyChart height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 40, bottom: 0, left: 4 }}
      >
        <XAxis
          type="number"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={money ? (v: number) => formatMoneyCompact(v, currency) : undefined}
        />
        <YAxis
          type="category"
          dataKey={nameKey}
          width={130}
          tick={{ ...AXIS_TICK, fill: "hsl(var(--foreground))" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<MoneyTooltip currency={currency} countKeys={money ? [] : [name]} />} />
        <Bar
          dataKey={dataKey}
          name={name}
          fill="var(--chart-1)"
          radius={[0, 4, 4, 0]}
          maxBarSize={18}
          label={{
            position: "right",
            fontSize: 11,
            fill: "hsl(var(--muted-foreground))",
            formatter: (v) => (money ? formatMoneyCompact(Number(v), currency) : String(v)),
          }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// --------------------------------------------------------------------- donut
/** Share of a money total (payment methods, expense categories). ≤4 slices.
 *  Color follows the entity, not its rank: slices are colored after sorting
 *  by name, so a category keeps its hue when totals reorder. Pass `color` on
 *  an item to pin a hue explicitly (e.g. cash is always the money hue). */
export function DonutChart({
  data,
  currency,
  height = 220,
  totalLabel = "Total",
  maxSlices = 4,
}: {
  data: { name: string; value: number; color?: string }[];
  currency: string;
  height?: number;
  totalLabel?: string;
  /** Slices to show before folding the tail into "Other". */
  maxSlices?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!data.length || total === 0) return <EmptyChart height={height} />;
  // Keep at most `maxSlices` slices (largest first); fold the tail into "Other".
  const byValue = [...data].sort((a, b) => b.value - a.value);
  const shown = byValue.slice(0, maxSlices);
  const rest = byValue.slice(maxSlices).reduce((s, d) => s + d.value, 0);
  // Assign hues by stable name order so entities keep their color across
  // ranges; explicit `color` wins.
  const nameOrder = shown.map((d) => d.name).sort();
  const colored = shown.map((d) => ({
    ...d,
    color: d.color ?? CHART_COLORS[nameOrder.indexOf(d.name) % CHART_COLORS.length],
  }));
  const slices =
    rest > 0
      ? [...colored, { name: "Other", value: rest, color: "hsl(var(--muted-foreground))" }]
      : colored;
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width="50%" height={height}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="90%"
            paddingAngle={2}
            stroke="hsl(var(--card))"
            strokeWidth={2}
          >
            {slices.map((s, i) => (
              <Cell key={i} fill={s.color} />
            ))}
          </Pie>
          <Tooltip content={<MoneyTooltip currency={currency} />} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="flex-1 space-y-1.5 text-xs">
        {slices.map((s) => (
          <li key={s.name} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {formatMoney(s.value, currency)}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-2 border-t pt-1.5 font-medium">
          <span>{totalLabel}</span>
          <span className="font-mono tabular-nums">{formatMoney(total, currency)}</span>
        </li>
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------- sparkline
/** Tiny inline trend for a KPI tile — no axes, no tooltip. */
export function Sparkline({
  data,
  dataKey,
  height = 36,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  height?: number;
}) {
  if (!data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke="var(--chart-1)"
          strokeWidth={1.5}
          fill="url(#sparkFill)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ------------------------------------------------------------- compare bars
/** Grouped money bars per category (owner console: shops side by side). */
export function CompareBarChart({
  data,
  nameKey,
  series,
  currency,
  height = 280,
}: {
  data: Record<string, unknown>[];
  nameKey: string;
  series: { dataKey: string; name: string; color: string }[];
  currency: string;
  height?: number;
}) {
  if (!data.length) return <EmptyChart height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} barGap={2}>
        <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={nameKey} tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => formatMoneyCompact(v, currency)}
        />
        <Tooltip content={<MoneyTooltip currency={currency} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s) => (
          <Bar
            key={s.dataKey}
            dataKey={s.dataKey}
            name={s.name}
            fill={s.color}
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Card-style wrapper so every chart sits in the same frame. */
export function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="mb-3 text-sm font-semibold">{title}</p>
      {children}
    </div>
  );
}
