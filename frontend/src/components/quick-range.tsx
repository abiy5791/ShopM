import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface DateRange {
  start: string; // YYYY-MM-DD ("" = server default)
  end: string;
}

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function presets(): { label: string; range: DateRange }[] {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  return [
    { label: "Today", range: { start: iso(today), end: iso(today) } },
    { label: "Yesterday", range: { start: iso(yesterday), end: iso(yesterday) } },
    { label: "Last 7 days", range: { start: iso(weekAgo), end: iso(today) } },
    { label: "This month", range: { start: iso(monthStart), end: iso(today) } },
    { label: "Last month", range: { start: iso(lastMonthStart), end: iso(lastMonthEnd) } },
  ];
}

/**
 * One-click date ranges + custom pickers (v2 plan §4). The active preset is
 * derived from the current value, so external changes stay in sync.
 */
export function QuickRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const options = presets();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap rounded-md border bg-card p-0.5">
        {options.map((p) => {
          const active = value.start === p.range.start && value.end === p.range.end;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.range)}
              className={
                "rounded px-2.5 py-1.5 text-xs font-medium transition-colors " +
                (active ? "bg-secondary text-secondary-foreground" : "hover:bg-muted")
              }
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-end gap-2">
        <div>
          <Label htmlFor="range-start" className="text-xs">
            From
          </Label>
          <Input
            id="range-start"
            type="date"
            className="h-8"
            value={value.start}
            onChange={(e) => onChange({ ...value, start: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="range-end" className="text-xs">
            To
          </Label>
          <Input
            id="range-end"
            type="date"
            className="h-8"
            value={value.end}
            onChange={(e) => onChange({ ...value, end: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

/** Default range for report pages: the last 7 days. */
export function defaultRange(): DateRange {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);
  return { start: iso(weekAgo), end: iso(today) };
}
