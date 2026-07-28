import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  ETHIOPIAN_MONTHS,
  ethiopianMonthLength,
  ethiopianToday,
  ethiopianToGregorianIso,
  isoToEthiopian,
} from "@/lib/ethiopian";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** Weekday index (0=Sun) of a Gregorian date-only ISO, read as a local date. */
function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/**
 * A date picker that displays and navigates in the **Ethiopian calendar** but
 * stores/returns a Gregorian ISO string ("YYYY-MM-DD"), so the rest of the app
 * and the API are unchanged. Self-contained popover — no extra dependency.
 */
export function EthiopianDatePicker({
  value,
  onChange,
  max,
  min,
  id,
  className,
  placeholder = "Pick a date",
  ariaLabel,
  clearable = false,
}: {
  value: string; // Gregorian ISO, "" = empty
  onChange: (iso: string) => void;
  max?: string; // Gregorian ISO upper bound (inclusive)
  min?: string; // Gregorian ISO lower bound (inclusive)
  id?: string;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Show a clear (×) button to empty the field. */
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Anchor the panel to the right edge when the trigger sits too close to the
  // viewport's right side, so the calendar never runs off-screen (mobile + web).
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // The month being viewed (Ethiopian). Seeded from the value, else today.
  const seed = value ? isoToEthiopian(value) : ethiopianToday();
  const [view, setView] = useState({ year: seed.year, month: seed.month });

  // Re-seed the view whenever the picker opens, so it lands on the current value.
  useEffect(() => {
    if (open) {
      const s = value ? isoToEthiopian(value) : ethiopianToday();
      setView({ year: s.year, month: s.month });
    }
  }, [open, value]);

  // Decide left/right anchoring before paint to avoid a flash off-screen.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const PANEL_WIDTH = 272; // w-[17rem]
    const rect = ref.current.getBoundingClientRect();
    setAlignRight(rect.left + PANEL_WIDTH > window.innerWidth - 8);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function shiftMonth(delta: number) {
    setView((v) => {
      let month = v.month + delta;
      let year = v.year;
      while (month < 1) {
        month += 13;
        year -= 1;
      }
      while (month > 13) {
        month -= 13;
        year += 1;
      }
      return { year, month };
    });
  }

  const selected = value ? isoToEthiopian(value) : null;
  const today = ethiopianToday();
  const length = ethiopianMonthLength(view.year, view.month);
  const firstIso = ethiopianToGregorianIso(view.year, view.month, 1);
  const lead = weekdayOf(firstIso);

  const label = value ? `${ETHIOPIAN_MONTHS[selected!.month - 1]} ${selected!.day}, ${selected!.year}` : "";

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        id={id}
        type="button"
        aria-label={ariaLabel ?? "Pick a date"}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm ring-offset-background",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !value && "text-muted-foreground",
        )}
      >
        <span className="truncate tabular-nums">{value ? label : placeholder}</span>
        <span className="flex shrink-0 items-center gap-0.5">
          {clearable && value && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear date"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
        </span>
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 mt-1 w-[17rem] max-w-[calc(100vw-1rem)] rounded-md border bg-popover p-3 text-popover-foreground shadow-md",
            alignRight ? "right-0" : "left-0",
          )}
        >
          {/* Header: year & month navigation */}
          <div className="mb-2 flex items-center justify-between gap-1">
            <div className="flex gap-0.5">
              <NavBtn onClick={() => shiftMonth(-13)} label="Previous year">
                <ChevronsLeft className="h-4 w-4" />
              </NavBtn>
              <NavBtn onClick={() => shiftMonth(-1)} label="Previous month">
                <ChevronLeft className="h-4 w-4" />
              </NavBtn>
            </div>
            <div className="text-center text-sm font-medium">
              {ETHIOPIAN_MONTHS[view.month - 1]} {view.year}
            </div>
            <div className="flex gap-0.5">
              <NavBtn onClick={() => shiftMonth(1)} label="Next month">
                <ChevronRight className="h-4 w-4" />
              </NavBtn>
              <NavBtn onClick={() => shiftMonth(13)} label="Next year">
                <ChevronsRight className="h-4 w-4" />
              </NavBtn>
            </div>
          </div>

          {/* Weekday header */}
          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((w) => (
              <span key={w} className="text-[10px] font-medium uppercase text-muted-foreground">
                {w}
              </span>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: lead }).map((_, i) => (
              <span key={`b${i}`} />
            ))}
            {Array.from({ length }).map((_, i) => {
              const day = i + 1;
              const iso = ethiopianToGregorianIso(view.year, view.month, day);
              const disabled = (max && iso > max) || (min && iso < min);
              const isSelected =
                selected &&
                selected.year === view.year &&
                selected.month === view.month &&
                selected.day === day;
              const isToday =
                today.year === view.year && today.month === view.month && today.day === day;
              return (
                <button
                  key={day}
                  type="button"
                  disabled={Boolean(disabled)}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-8 items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    isSelected && "bg-primary text-primary-foreground hover:bg-primary",
                    !isSelected && isToday && "border border-accent text-accent",
                    disabled && "cursor-not-allowed opacity-30 hover:bg-transparent",
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Today shortcut */}
          <div className="mt-2 flex justify-end border-t pt-2">
            <button
              type="button"
              className="rounded px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10"
              onClick={() => {
                const g = new Date();
                const iso = `${g.getFullYear()}-${String(g.getMonth() + 1).padStart(2, "0")}-${String(
                  g.getDate(),
                ).padStart(2, "0")}`;
                if (!(max && iso > max) && !(min && iso < min)) {
                  onChange(iso);
                  setOpen(false);
                }
              }}
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NavBtn({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    >
      {children}
    </button>
  );
}
