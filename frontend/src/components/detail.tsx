import type { ReactNode } from "react";

/**
 * Shared building blocks for detail dialogs so every "record detail" reads the
 * same. `DetailField` is a label/value pair that sits inline (label left, value
 * right) on a phone and stacks (label over value) from `sm` up.
 */
export function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:block">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right sm:mt-0.5 sm:text-left">{children}</dd>
    </div>
  );
}

/** A titled block (uppercase mono eyebrow) for a detail dialog section. */
export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}
