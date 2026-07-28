import { Label } from "@/components/ui/label";
import { ethiopianMonthRange } from "@/lib/ethiopian";

import { EthiopianDatePicker } from "./ethiopian-date-picker";

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
  // "This/Last month" follow the ETHIOPIAN calendar (Meskerem, Tikimt, …), since
  // the shop's month is Ethiopian. "This month" ends today; last month is full.
  const thisMonth = ethiopianMonthRange(0);
  const lastMonth = ethiopianMonthRange(-1);
  return [
    { label: "Today", range: { start: iso(today), end: iso(today) } },
    { label: "Yesterday", range: { start: iso(yesterday), end: iso(yesterday) } },
    { label: "Last 7 days", range: { start: iso(weekAgo), end: iso(today) } },
    { label: thisMonth.label, range: { start: thisMonth.start, end: iso(today) } },
    { label: lastMonth.label, range: { start: lastMonth.start, end: lastMonth.end } },
  ];
}

/**
 * One-click date ranges + custom pickers (v2 plan §4). The active preset is
 * derived from the current value, so external changes stay in sync.
 */
export function QuickRangePicker({
  value,
  onChange,
  showPresets = true,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** Show the one-click preset buttons (Today, This month, …). */
  showPresets?: boolean;
}) {
  const options = presets();
  return (
    <div className="flex flex-wrap items-end gap-2">
      {showPresets && (
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
      )}
      <div className="flex items-end gap-2">
        <div>
          <Label htmlFor="range-start" className="text-xs">
            From
          </Label>
          <EthiopianDatePicker
            id="range-start"
            className="w-40"
            placeholder="From"
            clearable
            value={value.start}
            onChange={(start) => onChange({ ...value, start })}
          />
        </div>
        <div>
          <Label htmlFor="range-end" className="text-xs">
            To
          </Label>
          <EthiopianDatePicker
            id="range-end"
            className="w-40"
            placeholder="To"
            clearable
            value={value.end}
            onChange={(end) => onChange({ ...value, end })}
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
