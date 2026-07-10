"""Money helpers (plan §3.5). Money is stored as integer minor units everywhere.

No floats for money, ever. Parse at the input edge, format at the display edge.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django.db import models

# Minor-unit exponent per currency (how many decimal places the currency has).
CURRENCY_EXPONENTS: dict[str, int] = {
    "ETB": 2,
    "USD": 2,
    "EUR": 2,
    "GBP": 2,
    "KES": 2,
    "NGN": 2,
    "GHS": 2,
    "INR": 2,
    "JPY": 0,
    "UGX": 0,
    "TZS": 2,
}

DEFAULT_EXPONENT = 2

# Common display symbols; falls back to the ISO code.
CURRENCY_SYMBOLS: dict[str, str] = {
    "ETB": "Br",
    "USD": "$",
    "EUR": "€",
    "GBP": "£",
    "INR": "₹",
    "NGN": "₦",
    "KES": "KSh",
    "GHS": "₵",
}


def exponent(currency: str) -> int:
    return CURRENCY_EXPONENTS.get(currency.upper(), DEFAULT_EXPONENT)


def to_minor(amount: str | Decimal | int | float, currency: str) -> int:
    """Convert a human amount (e.g. '12.50') to integer minor units (1250).

    Floats are accepted but coerced through Decimal(str(...)) to avoid binary
    rounding surprises. Raises ValueError on garbage input.
    """
    try:
        dec = Decimal(str(amount))
    except (InvalidOperation, TypeError) as exc:
        raise ValueError(f"Invalid money amount: {amount!r}") from exc
    factor = Decimal(10) ** exponent(currency)
    return int((dec * factor).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def to_major(minor: int, currency: str) -> Decimal:
    """Convert integer minor units back to a Decimal major amount."""
    factor = Decimal(10) ** exponent(currency)
    return (Decimal(minor) / factor).quantize(
        Decimal(1).scaleb(-exponent(currency)), rounding=ROUND_HALF_UP
    )


def format_money(minor: int, currency: str, *, with_symbol: bool = True) -> str:
    """Format integer minor units for display, e.g. (1250, 'USD') -> '$12.50'."""
    major = to_major(minor, currency)
    text = f"{major:,.{exponent(currency)}f}"
    if with_symbol:
        symbol = CURRENCY_SYMBOLS.get(currency.upper())
        if symbol:
            return f"{symbol}{text}"
    return f"{text} {currency.upper()}"


class MoneyField(models.BigIntegerField):
    """Stores money as integer minor units. A semantic alias for BigIntegerField
    so model definitions read clearly and we never accidentally use a float/decimal."""

    description = "Monetary value in integer minor units"
