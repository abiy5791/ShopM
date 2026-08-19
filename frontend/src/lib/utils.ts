import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import { formatEthiopianDateTime } from "./ethiopian";

/** Merge Tailwind class names, resolving conflicts (shadcn convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Today as a "YYYY-MM-DD" LOCAL date. Never use `toISOString()` for this —
 *  it is UTC, so after 9pm in Addis (UTC+3) it reports tomorrow. */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** One date-time format for every table. The shop runs on the Ethiopian
 *  calendar, so this renders "Hamle 20, 2018, 3:00 PM" (Ethiopian date, local
 *  time). All existing call sites get Ethiopian dates through this one function. */
export function formatDateTime(iso: string): string {
  return formatEthiopianDateTime(iso);
}
