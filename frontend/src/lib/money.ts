/**
 * Frontend money helpers. Mirrors the backend (plan §3.5): money is integer
 * minor units; format only at the display edge. Never do business math here.
 */

const EXPONENTS: Record<string, number> = {
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

/** Format integer minor units, e.g. (1250, "USD") -> "$12.50". */
export function formatMoney(minor: number, currency: string): string {
  const exp = exponent(currency);
  const major = minor / 10 ** exp;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(major);
  } catch {
    // Unknown ISO code — fall back to a plain number + code.
    return `${major.toFixed(exp)} ${currency.toUpperCase()}`;
  }
}
