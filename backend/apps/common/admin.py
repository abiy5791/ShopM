"""Showing money in the Django admin (plan §3.5).

Money is stored as integer minor units everywhere — Br700.00 is the integer
70000 — because integers cannot drift the way floats do. That is right for the
database and for the API, but the admin was rendering the raw column, so a price
read as "70000" and a sale total as "175000". The figures were always correct;
only the presentation was missing the step the frontend already does at its
display edge.

These helpers put that step back, in both directions:

* ``money_column`` renders a stored integer with the row's own currency, while
  keeping the column sortable on the underlying integer.
* ``MoneyAdminMixin`` points each editable money input at the row's currency, so
  a form that *shows* major units also *saves* them (see
  ``apps.common.money.MoneyFormField``).

Currency is per shop (``ShopSettings.currency``), so it is resolved from the row
rather than assumed — a shop on a zero-decimal currency must not gain two
decimal places it does not have.
"""

from __future__ import annotations

from .money import MoneyFormField, currency_of, format_money

# Currency resolution lives in `money` so model ``__str__`` methods can share it.
currency_for = currency_of


def money_column(field_name: str, label: str):
    """An admin column that renders a money field for people.

    Assign it to a named attribute on the ModelAdmin (or inline) and reference
    that name — the same name then works in both ``list_display`` and
    ``readonly_fields``. Sorting stays on the raw integer column, so ordering is
    still exact and index-backed.
    """

    def column(self, obj):
        value = getattr(obj, field_name, None)
        if value is None:
            return "—"
        return format_money(value, currency_for(obj))

    column.short_description = label
    column.admin_order_field = field_name
    return column


class MoneyAdminMixin:
    """Makes editable money inputs read *and* write major units.

    Money inputs are built before any row is known, so they start on the site
    default currency; this re-targets them at the object being edited. Without
    it a form could display "700.00" and save 700 minor units — Br7.00 — which
    is worse than showing the raw integer.
    """

    def _retarget_money_fields(self, form_class, obj=None) -> None:
        currency = currency_for(obj)
        for field in form_class.base_fields.values():
            if isinstance(field, MoneyFormField):
                field.set_currency(currency)

    def get_form(self, request, obj=None, **kwargs):
        form_class = super().get_form(request, obj, **kwargs)
        self._retarget_money_fields(form_class, obj)
        return form_class
