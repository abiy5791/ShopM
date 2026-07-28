import { describe, expect, it } from "vitest";

import {
  ethiopianMonthLength,
  ethiopianToGregorianIso,
  formatEthiopian,
  gregorianToEthiopian,
  isoToEthiopian,
} from "./ethiopian";

describe("ethiopian calendar", () => {
  it("matches known anchor dates", () => {
    expect(gregorianToEthiopian(2016, 9, 11)).toEqual({ year: 2009, month: 1, day: 1 });
    expect(gregorianToEthiopian(2023, 9, 12)).toEqual({ year: 2016, month: 1, day: 1 });
    expect(gregorianToEthiopian(2024, 1, 1)).toEqual({ year: 2016, month: 4, day: 22 });
    expect(gregorianToEthiopian(2026, 7, 27)).toEqual({ year: 2018, month: 11, day: 20 });
  });

  it("formats an Ethiopian date", () => {
    expect(formatEthiopian("2026-07-27")).toBe("Hamle 20, 2018");
  });

  it("round-trips every day across 40 years", () => {
    const d = new Date(Date.UTC(1995, 0, 1));
    const end = Date.UTC(2035, 11, 31);
    while (d.getTime() <= end) {
      const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
        d.getUTCDate(),
      ).padStart(2, "0")}`;
      const e = isoToEthiopian(iso);
      expect(ethiopianToGregorianIso(e.year, e.month, e.day)).toBe(iso);
      d.setUTCDate(d.getUTCDate() + 1);
    }
  });

  it("has 30-day months and 5/6-day Pagumē", () => {
    expect(ethiopianMonthLength(2018, 11)).toBe(30);
    expect(ethiopianMonthLength(2018, 13)).toBe(5);
    expect(ethiopianMonthLength(2019, 13)).toBe(6); // 2019 % 4 === 3
  });
});
