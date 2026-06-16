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
