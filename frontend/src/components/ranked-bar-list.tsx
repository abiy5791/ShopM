import { cn } from "@/lib/utils";

export interface RankedItem {
  name: string;
  value: number;
}

/**
 * A ranked "leaderboard" list — numbered rows with a proportional bar and the
 * value. Reads better than a bar chart for a short ranking of named items
 * (top/best sellers): the order is explicit and long names aren't squeezed.
 */
export function RankedBarList({
  items,
  formatValue = (v) => String(v),
  emptyText = "No data yet.",
}: {
  items: RankedItem[];
  formatValue?: (value: number) => string;
  emptyText?: string;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <ol className="space-y-3">
      {items.map((item, i) => {
        const pct = Math.max(2, (item.value / max) * 100);
        return (
          <li key={i} className="flex items-center gap-3">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold tabular-nums",
                i === 0
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm">{item.name}</span>
                <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                  {formatValue(item.value)}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
