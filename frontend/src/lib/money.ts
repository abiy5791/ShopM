/**
 * Frontend money helpers. Mirrors the backend (plan §3.5): money is integer
 * minor units; format only at the display edge. Never do business math here.
 */

const EXPONENTS: Record<string, number> = {
  ETB: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  KES: 2,
  NGN: 2,
  GHS: 2,
  INR: 2,
  JPY: 0,
  UGX: 0,
  TZS: 2,
};

// Display symbols, mirroring the backend's CURRENCY_SYMBOLS (apps/common/money.py).
// We format the symbol ourselves rather than relying on Intl's "narrowSymbol",
// whose data varies by browser/runtime ICU (e.g. ETB can fall back to "ETB").
const SYMBOLS: Record<string, string> = {
  ETB: "Br",
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
  NGN: "₦",
  KES: "KSh",
  GHS: "₵",
};

export function exponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

/**
 * Parse a human amount (e.g. "12.50") into integer minor units (1250).
 * Returns NaN for invalid input so callers / Zod can reject it.
 */
export function parseMoney(input: string | number, currency: string): number {
  const value = typeof input === "number" ? input : Number(String(input).trim());
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value * 10 ** exponent(currency));
}

/** Integer minor units -> a plain major-unit string for editing, e.g. 1250 -> "12.50". */
export function minorToInput(minor: number, currency: string): string {
  return (minor / 10 ** exponent(currency)).toFixed(exponent(currency));
}

/**
 * Format integer minor units for display, mirroring the backend's format_money
 * byte-for-byte: e.g. (1250, "ETB") -> "Br12.50", (1250, "USD") -> "$12.50".
 * Grouping is fixed to en-US ("Br1,250.00") so receipts read the same everywhere
 * and match the server; unknown currencies fall back to "12.34 ZZ".
 */
export function formatMoney(minor: number, currency: string): string {
  const exp = exponent(currency);
  const major = minor / 10 ** exp;
  const code = currency.toUpperCase();
  const number = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(major);
  const symbol = SYMBOLS[code];
  return symbol ? `${symbol}${number}` : `${number} ${code}`;
}
