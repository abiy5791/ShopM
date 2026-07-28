"""Ethiopian (Ge'ez) calendar ↔ Gregorian conversion.

The Ethiopian calendar has 13 months: twelve of 30 days, plus Pagumē — a short
13th month of 5 days (6 in a leap year, when ``year % 4 == 3``). Because there is
no 31-day month, monthly costs (salary, rent) must be prorated over the Ethiopian
month, not the Gregorian one.

Conversion is done through the Julian Day Number (JDN) using the Amete Mihret
epoch, so it is exact and needs no third-party library.
"""

from __future__ import annotations

from datetime import date

# JDN of 1 Meskerem 1 (Amete Mihret) minus 1 — the standard offset constant.
_JD_EPOCH_OFFSET_AMETE_MIHRET = 1723856

MONTH_NAMES = [
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
]


def _gregorian_to_jdn(year: int, month: int, day: int) -> int:
    a = (14 - month) // 12
    y = year + 4800 - a
    m = month + 12 * a - 3
    return day + (153 * m + 2) // 5 + 365 * y + y // 4 - y // 100 + y // 400 - 32045


def _jdn_to_gregorian(jdn: int) -> tuple[int, int, int]:
    a = jdn + 32044
    b = (4 * a + 3) // 146097
    c = a - (146097 * b) // 4
    d = (4 * c + 3) // 1461
    e = c - (1461 * d) // 4
    m = (5 * e + 2) // 153
    day = e - (153 * m + 2) // 5 + 1
    month = m + 3 - 12 * (m // 10)
    year = 100 * b + d - 4800 + m // 10
    return year, month, day


def _jdn_to_ethiopian(jdn: int) -> tuple[int, int, int]:
    r = (jdn - _JD_EPOCH_OFFSET_AMETE_MIHRET) % 1461
    n = (r % 365) + 365 * (r // 1460)
    year = 4 * ((jdn - _JD_EPOCH_OFFSET_AMETE_MIHRET) // 1461) + (r // 365) - (r // 1460)
    month = (n // 30) + 1
    day = (n % 30) + 1
    return year, month, day


def _ethiopian_to_jdn(year: int, month: int, day: int) -> int:
    return (
        (_JD_EPOCH_OFFSET_AMETE_MIHRET + 365)
        + 365 * (year - 1)
        + year // 4
        + 30 * (month - 1)
        + day
        - 1
    )


def to_ethiopian(g: date) -> tuple[int, int, int]:
    """Gregorian date → (ethiopian_year, month 1-13, day)."""
    return _jdn_to_ethiopian(_gregorian_to_jdn(g.year, g.month, g.day))


def to_gregorian(year: int, month: int, day: int) -> date:
    """Ethiopian (year, month 1-13, day) → Gregorian ``date``."""
    y, m, d = _jdn_to_gregorian(_ethiopian_to_jdn(year, month, day))
    return date(y, m, d)


def is_leap_year(year: int) -> bool:
    """Ethiopian leap year — Pagumē has 6 days when ``year % 4 == 3``."""
    return year % 4 == 3


def month_length(year: int, month: int) -> int:
    """Days in an Ethiopian month: 30 for months 1–12, 5 or 6 for Pagumē (13)."""
    if month == 13:
        return 6 if is_leap_year(year) else 5
    return 30


def month_bounds_gregorian(g: date) -> tuple[date, date]:
    """Gregorian [first_day, last_day] of the Ethiopian month containing ``g``."""
    year, month, _ = to_ethiopian(g)
    first = to_gregorian(year, month, 1)
    last = to_gregorian(year, month, month_length(year, month))
    return first, last


def format_ethiopian(g: date) -> str:
    """Gregorian date → e.g. ``"Hamle 20, 2018"`` (Ethiopian calendar)."""
    year, month, day = to_ethiopian(g)
    return f"{MONTH_NAMES[month - 1]} {day}, {year}"
