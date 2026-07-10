import { describe, expect, it } from "vitest";

import { exponent, formatMoney } from "./money";

describe("money", () => {
  it("knows currency exponents", () => {
    expect(exponent("ETB")).toBe(2);
    expect(exponent("USD")).toBe(2);
    expect(exponent("JPY")).toBe(0);
    expect(exponent("ZZZ")).toBe(2); // unknown -> default
  });

  it("formats integer minor units at the display edge", () => {
    // Ethiopian Birr is the default — renders "Br", matching the backend.
    expect(formatMoney(1250, "ETB")).toBe("Br12.50");
    expect(formatMoney(123456, "ETB")).toBe("Br1,234.56");
    expect(formatMoney(1250, "USD")).toBe("$12.50");
    expect(formatMoney(0, "USD")).toBe("$0.00");
    // 0-exponent currency renders no decimals.
    expect(formatMoney(500, "JPY")).toContain("500");
  });

  it("falls back gracefully for malformed currency codes", () => {
    // A 2-letter code is malformed -> Intl throws -> we use the plain fallback.
    expect(formatMoney(1234, "ZZ")).toBe("12.34 ZZ");
  });
});
