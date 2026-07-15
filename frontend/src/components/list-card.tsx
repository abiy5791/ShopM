import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A single record rendered as a tappable card — the mobile counterpart to a
 * table row. Pages show `<Table>` from `md` up and a list of these below it, so
 * dense grids don't force horizontal scrolling on a phone.
 *
 * `title` leads, `meta` is a wrap of small label/value facts, `trailing` holds
 * the figure/status on the right, and `actions` (if given) replaces the chevron
 * with a control — its own click must stopPropagation so it doesn't also open
 * the row.
 */
export function ListCard({
  title,
  subtitle,
  meta,
  trailing,
  actions,
  onClick,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const interactive = Boolean(onClick);
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={cn(
        "flex items-start gap-3 px-4 py-3",
        interactive &&
          "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        {subtitle && (
          <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{subtitle}</div>
        )}
        {meta && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {meta}
          </div>
        )}
      </div>
      {(trailing || actions || interactive) && (
        <div className="flex shrink-0 items-center gap-2">
          {trailing && <div className="flex flex-col items-end gap-1 text-right">{trailing}</div>}
          {actions}
          {interactive && !actions && (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
          )}
        </div>
      )}
    </div>
  );
}

/** One muted `label value` fact for a ListCard's `meta` row. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="text-foreground/80">{children}</span>
    </span>
  );
}
