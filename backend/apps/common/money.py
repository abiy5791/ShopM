"""Money helpers (plan §3.5). Money is stored as integer minor units everywhere.

No floats for money, ever. Parse at the input edge, format at the display edge.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from django import forms
from django.conf import settings as django_settings
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


#: How to reach the owning Shop from a row that does not hold one directly.
_SHOP_PATHS = ("shop", "sale.shop", "purchase.shop", "product.shop")


def currency_of(obj) -> str:
    """The currency a row's money is denominated in, resolved from its shop.

    Currency is per shop (``ShopSettings.currency``), so it is looked up rather
    than assumed — a shop on a zero-decimal currency must not gain two decimal
    places it does not have.

    Never raises. This is reached from ``__str__`` and from admin rendering, and
    a label that blows up would take out whole admin pages and error messages
    for the sake of a display detail; falling back to the site default is always
    better than that.
    """
    default = getattr(django_settings, "DEFAULT_CURRENCY", "ETB")
    if obj is None:
        return default
    try:
        for path in _SHOP_PATHS:
            target = obj
            for part in path.split("."):
                target = getattr(target, part, None)
                if target is None:
                    break
            if target is not None:
                shop_settings = getattr(target, "settings", None)
                return shop_settings.currency if shop_settings is not None else default
    except Exception:  # noqa: BLE001 - a label must never break the page
        return default
    return default


class MoneyFormField(forms.DecimalField):
    """Edits money in major units ("700.00") while the model stores minor ones.

    Scope matters here. This is reached only through ``models.Field.formfield()``,
    which is what **Django ModelForms** — in this project, the admin and nothing
    else — use to build an input. The REST API is untouched: DRF maps a model
    field to a serializer field by *class* and never calls ``formfield()``, so
    the API keeps sending and receiving integer minor units exactly as before.

    Without this, the admin would read "700.00" but save whatever integer was
    typed, so a human correcting a price to 750.00 would store 750 minor units
    (Br7.50). Displaying major units and accepting minor ones is a trap; the two
    have to move together.
    """

    def __init__(self, *, currency: str | None = None, **kwargs):
        kwargs.setdefault("max_digits", 20)
        self.currency = currency or django_settings.DEFAULT_CURRENCY
        kwargs.setdefault("decimal_places", exponent(self.currency))
        kwargs.setdefault("help_text", "")
        super().__init__(**kwargs)

    def set_currency(self, currency: str) -> None:
        """Re-target the field at a row's own currency (see MoneyAdminMixin).

        The field is built before any row is known, so it starts on the site
        default; a shop on a zero-decimal currency (JPY, UGX) needs the decimal
        places corrected once the object is in hand.
        """
        self.currency = currency
        self.decimal_places = exponent(currency)

    def prepare_value(self, value):
        # An unbound form hands over the stored integer, which becomes "700.00".
        # A bound form that failed validation hands back the raw string the user
        # typed, which must pass straight through or it would be divided twice.
        if isinstance(value, bool) or not isinstance(value, int):
            return value
        return to_major(value, self.currency)

    def clean(self, value):
        amount = super().clean(value)
        if amount is None:
            return None
        return to_minor(amount, self.currency)


class MoneyField(models.BigIntegerField):
    """Stores money as integer minor units. A semantic alias for BigIntegerField
    so model definitions read clearly and we never accidentally use a float/decimal."""

    description = "Monetary value in integer minor units"

    def formfield(self, **kwargs):
        """Django forms (the admin) edit this in major units; see MoneyFormField.

        DRF does not go through here, so the API contract is unchanged.
        """
        return super().formfield(**{"form_class": MoneyFormField, **kwargs})
