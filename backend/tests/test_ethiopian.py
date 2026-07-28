"""Ethiopian calendar conversion — anchors, round-trips, month lengths."""

from datetime import date, timedelta

from apps.common import ethiopian


def test_known_anchor_dates():
    # New Year (Enkutatash) and a couple of mid-month checks.
    assert ethiopian.to_ethiopian(date(2016, 9, 11)) == (2009, 1, 1)
    assert ethiopian.to_ethiopian(date(2023, 9, 12)) == (2016, 1, 1)  # 2024 is Gregorian leap
    assert ethiopian.to_ethiopian(date(2024, 1, 1)) == (2016, 4, 22)  # Tahsas 22
    assert ethiopian.to_ethiopian(date(2026, 7, 27)) == (2018, 11, 20)  # Hamle 20


def test_format():
    assert ethiopian.format_ethiopian(date(2026, 7, 27)) == "Hamle 20, 2018"


def test_round_trip_many_dates():
    d = date(1990, 1, 1)
    end = date(2040, 12, 31)
    while d <= end:
        y, m, day = ethiopian.to_ethiopian(d)
        assert ethiopian.to_gregorian(y, m, day) == d, d
        d += timedelta(days=1)


def test_month_lengths_and_pagume():
    # Months 1–12 are always 30 days.
    for m in range(1, 13):
        assert ethiopian.month_length(2018, m) == 30
    # Pagumē: 5 days normally, 6 in a leap year (year % 4 == 3).
    assert ethiopian.month_length(2018, 13) == 5
    assert ethiopian.month_length(2019, 13) == 6  # 2019 % 4 == 3
    assert ethiopian.is_leap_year(2019) and not ethiopian.is_leap_year(2018)


def test_month_bounds_hamle_has_30_days():
    first, last = ethiopian.month_bounds_gregorian(date(2026, 7, 27))  # Hamle 2018
    assert ethiopian.to_ethiopian(first) == (2018, 11, 1)
    assert ethiopian.to_ethiopian(last) == (2018, 11, 30)
    assert (last - first).days == 29  # 30 days inclusive
