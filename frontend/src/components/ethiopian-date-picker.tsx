import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  ETHIOPIAN_MONTHS,
  ethiopianMonthLength,
  ethiopianToday,
  ethiopianToGregorianIso,
  isoToEthiopian,
} from "@/lib/ethiopian";
import { cn, todayIso } from "@/lib/utils";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const PANEL_WIDTH = 272; // w-[17rem]
const GAP = 8; // breathing room against the trigger and the viewport edge

/** Weekday index (0=Sun) of a Gregorian date-only ISO, read as a local date. */
function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** Where the floating panel is pinned, in viewport coordinates. */
interface PanelPosition {
  top: number;
  left: number;
  maxHeight: number;
}

/**
 * A date picker that displays and navigates in the **Ethiopian calendar** but
 * stores/returns a Gregorian ISO string ("YYYY-MM-DD"), so the rest of the app
 * and the API are unchanged. Self-contained popover — no extra dependency.
 *
 * The calendar is rendered in a portal on `document.body` and positioned
 * `fixed`. That is deliberate: this picker sits low down inside the POS cart and
 * inside dialogs and bottom-sheets, all of which are `overflow-hidden`. An
 * absolutely-positioned panel gets clipped by whichever of those it happens to
 * be nested in, cutting off the last week of the month or the month navigation.
 * A portalled panel is measured against the viewport alone, flips above the
 * trigger when there is more room there, and caps its own height and scrolls
 * only when neither side can hold it.
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
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const rect = trigger.getBoundingClientRect();
    // `scrollHeight` rather than `offsetHeight`: once the panel has been capped
    // and made scrollable, this still reports the height it *wants*, so the cap
    // does not get dropped and re-applied on alternate opens.
    const wanted = panel.scrollHeight + 2; // +2 for the border

    const spaceBelow = window.innerHeight - rect.bottom - GAP;
    const spaceAbove = rect.top - GAP;
    const openUp = wanted > spaceBelow && spaceAbove > spaceBelow;
    const available = Math.max(openUp ? spaceAbove : spaceBelow, 160);
    const height = Math.min(wanted, available);

    setPosition({
      top: openUp ? Math.max(GAP, rect.top - GAP - height) : rect.bottom + GAP,
      // Prefer left-aligned with the trigger, but never past either edge.
      left: Math.max(GAP, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - GAP)),
      maxHeight: available,
    });
  }, []);

  // Position before paint so the panel never flashes in the wrong place.
  // Re-runs on `view` too: a 5-row month and a 6-row month differ in height.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    place();
  }, [open, view, place]);

  // The panel is portalled to <body>, which puts it *outside* any Radix dialog
  // it was opened from — and Radix decides "clicked outside, dismiss" from a
  // native listener on `document`. React's synthetic stopPropagation runs at
  // React's own root and never stops that, so the guard has to be a native
  // listener on the panel itself. Without this, picking a date inside the
  // expense, sale-edit or POS cart dialogs would close the dialog.
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const stop = (e: Event) => e.stopPropagation();
    const events = ["pointerdown", "mousedown", "touchstart", "focusin"] as const;
    for (const name of events) panel.addEventListener(name, stop);
    return () => {
      for (const name of events) panel.removeEventListener(name, stop);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      // The panel lives outside this component's DOM subtree now, so an
      // outside-click check has to consider it explicitly.
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Escape should close the calendar, not the dialog it was opened from.
      // Radix listens for Escape in the capture phase on `document`; a capture
      // listener on `window` runs one step earlier in the path, so stopping
      // propagation here keeps the surrounding dialog open.
      e.stopPropagation();
      setOpen(false);
    }

    // A fixed panel drifts away from its trigger when anything scrolls, so it
    // follows (capture: true catches scrolling ancestors, not just the page).
    // Repositioning reads layout, so it is coalesced to one measurement per
    // frame — doing it per scroll event forces a synchronous reflow on every
    // one and janks badly on a phone.
    let frame = 0;
    const reposition = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", reposition, { capture: true, passive: true });
    window.addEventListener("resize", reposition);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", reposition, { capture: true });
      window.removeEventListener("resize", reposition);
    };
  }, [open, place]);

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

  function pick(iso: string) {
    onChange(iso);
    setOpen(false);
  }

  const selected = value ? isoToEthiopian(value) : null;
  const today = ethiopianToday();
  const length = ethiopianMonthLength(view.year, view.month);
  const firstIso = ethiopianToGregorianIso(view.year, view.month, 1);
  const lead = weekdayOf(firstIso);
  const outOfRange = (iso: string) => Boolean((max && iso > max) || (min && iso < min));

  const label = selected
    ? `${ETHIOPIAN_MONTHS[selected.month - 1]} ${selected.day}, ${selected.year}`
    : "";

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel ?? "Pick a date"}
      style={{
        position: "fixed",
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        width: PANEL_WIDTH,
        maxHeight: position?.maxHeight,
        // Hidden for the single pre-paint frame in which it is measured.
        visibility: position ? "visible" : "hidden",
        // REQUIRED, not cosmetic. While a Radix dialog is open it sets
        // `pointer-events: none` on <body> and re-enables it only on its own
        // layer. This panel is a portalled child of <body>, so without this it
        // inherits `none`: the calendar renders but every click passes straight
        // through it to the overlay underneath, which reads as the whole page
        // having frozen. Any body-portalled overlay needs this.
        pointerEvents: "auto",
      }}
      className="z-[60] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border bg-popover p-3 text-popover-foreground shadow-md"
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
          const disabled = outOfRange(iso);
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
              disabled={disabled}
              onClick={() => pick(iso)}
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
            const iso = todayIso();
            if (!outOfRange(iso)) pick(iso);
          }}
        >
          Today
        </button>
      </div>
    </div>
  );

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-label={ariaLabel ?? "Pick a date"}
        aria-expanded={open}
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

      {open && createPortal(panel, document.body)}
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
