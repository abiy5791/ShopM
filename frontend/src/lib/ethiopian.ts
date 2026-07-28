/**
 * Ethiopian (Ge'ez) calendar ↔ Gregorian conversion — a mirror of the backend's
 * `apps/common/ethiopian.py`. 13 months: twelve of 30 days + Pagumē (5 days, 6 in
 * a leap year when `year % 4 === 3`). Conversion goes through the Julian Day
 * Number (Amete Mihret epoch), so it is exact and needs no library.
 *
 * Money/business logic never touches this — it's display + date-picker only.
 */

const JD_EPOCH_OFFSET_AMETE_MIHRET = 1723856;

export const ETHIOPIAN_MONTHS = [
  "Meskerem",
  "Tikimt",
  "Hidar",
  "Tahsas",
  "Tir",
  "Yekatit",
  "Megabit",
  "Miazia",
  "Ginbot",
  "Sene",
  "Hamle",
  "Nehase",
  "Pagumē",
];

export type EthDate = { year: number; month: number; day: number };

function gregorianToJdn(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

function jdnToGregorian(jdn: number): { year: number; month: number; day: number } {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return { year, month, day };
}

function jdnToEthiopian(jdn: number): EthDate {
  const offset = jdn - JD_EPOCH_OFFSET_AMETE_MIHRET;
  const r = ((offset % 1461) + 1461) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  const year = 4 * Math.floor(offset / 1461) + Math.floor(r / 365) - Math.floor(r / 1460);
  const month = Math.floor(n / 30) + 1;
  const day = (n % 30) + 1;
  return { year, month, day };
}

function ethiopianToJdn(year: number, month: number, day: number): number {
  return (
    JD_EPOCH_OFFSET_AMETE_MIHRET +
    365 +
    365 * (year - 1) +
    Math.floor(year / 4) +
    30 * (month - 1) +
    day -
    1
  );
}

/** Gregorian (y, m, d) → Ethiopian date. */
export function gregorianToEthiopian(year: number, month: number, day: number): EthDate {
  return jdnToEthiopian(gregorianToJdn(year, month, day));
}

/** Ethiopian date → Gregorian ISO "YYYY-MM-DD". */
export function ethiopianToGregorianIso(year: number, month: number, day: number): string {
  const g = jdnToGregorian(ethiopianToJdn(year, month, day));
  return `${g.year}-${pad(g.month)}-${pad(g.day)}`;
}

export function isEthiopianLeap(year: number): boolean {
  return year % 4 === 3;
}

/** Days in an Ethiopian month: 30 for months 1–12; 5 or 6 for Pagumē (13). */
export function ethiopianMonthLength(year: number, month: number): number {
  if (month === 13) return isEthiopianLeap(year) ? 6 : 5;
  return 30;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Parse a date-only ISO "YYYY-MM-DD" into its Ethiopian date (no timezone slip). */
export function isoToEthiopian(iso: string): EthDate {
  const [y, m, d] = iso.split("-").map(Number);
  return gregorianToEthiopian(y, m, d);
}

/** Ethiopian date parts of a JS Date read in local time. */
function localDateToEthiopian(date: Date): EthDate {
  return gregorianToEthiopian(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** ISO → "Hamle 20, 2018". Accepts a date-only string ("2026-07-27") or a full
 *  datetime ("2026-07-27T09:14:00Z", read in local time); shows no time. */
export function formatEthiopian(iso: string): string {
  if (!iso) return "";
  const e =
    iso.length > 10 || iso.includes("T") ? localDateToEthiopian(new Date(iso)) : isoToEthiopian(iso);
  return `${ETHIOPIAN_MONTHS[e.month - 1]} ${e.day}, ${e.year}`;
}

/** Short form → "Hamle 20" (no year). */
export function formatEthiopianShort(iso: string): string {
  if (!iso) return "";
  const e = isoToEthiopian(iso);
  return `${ETHIOPIAN_MONTHS[e.month - 1]} ${e.day}`;
}

/** Datetime ISO (with time) → "Hamle 20, 2018, 3:00 PM" — Ethiopian date, local time. */
export function formatEthiopianDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const e = localDateToEthiopian(d);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${ETHIOPIAN_MONTHS[e.month - 1]} ${e.day}, ${e.year}, ${time}`;
}

/** Today's Ethiopian date (local). */
export function ethiopianToday(): EthDate {
  return localDateToEthiopian(new Date());
}

/** First and last Gregorian ISO of the Ethiopian month `n` months from the one
 *  containing today (0 = current Ethiopian month, -1 = previous). */
export function ethiopianMonthRange(offset: number): { start: string; end: string; label: string } {
  const t = ethiopianToday();
  let year = t.year;
  let month = t.month + offset;
  // Normalise across the 13-month year.
  while (month < 1) {
    month += 13;
    year -= 1;
  }
  while (month > 13) {
    month -= 13;
    year += 1;
  }
  const start = ethiopianToGregorianIso(year, month, 1);
  const end = ethiopianToGregorianIso(year, month, ethiopianMonthLength(year, month));
  return { start, end, label: `${ETHIOPIAN_MONTHS[month - 1]} ${year}` };
}
