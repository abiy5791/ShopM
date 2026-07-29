"""Product .xlsx import/export.

The sheet is a human-facing surface, so money columns hold **major** units
(``150.00``) rather than the integer minor units we store (plan §3.5). Values
pass through ``apps.common.money`` in both directions, so a round-trip is exact
and never introduces float error.

Import is row-tolerant on purpose: one unusable row is reported and skipped,
the rest still land. Only a file we can't read at all raises SpreadsheetError.
"""

from __future__ import annotations

import io
import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from zipfile import BadZipFile

from django.db import DatabaseError, transaction
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter
from openpyxl.utils.exceptions import InvalidFileException

from apps.common.money import exponent, to_major, to_minor

from .models import Category, Product, Supplier

COLUMNS = [
    "sku",
    "name",
    "barcode",
    "category",
    "supplier",
    "unit",
    "purchase_price",
    "selling_price",
    "min_stock_alert",
    "status",
]
MONEY_COLUMNS = ("purchase_price", "selling_price")

#: Column widths, so the file opens readable instead of a wall of "#####".
COLUMN_WIDTHS = {
    "sku": 16,
    "name": 34,
    "barcode": 18,
    "category": 18,
    "supplier": 20,
    "unit": 8,
    "purchase_price": 15,
    "selling_price": 14,
    "min_stock_alert": 16,
    "status": 10,
}
#: Text limits, mirroring the model fields so a long cell is a row error
#: instead of a database error.
MAX_LENGTHS = {
    "sku": 64,
    "name": 255,
    "barcode": 64,
    "unit": 16,
    "category": 128,
    "supplier": 255,
}
#: Guard-rails for uploads: bigger files are a mistake, not a catalogue.
MAX_ROWS = 5_000
#: Errors are echoed back to the UI, so cap the payload; ``skipped`` keeps the total.
MAX_ERRORS = 50


class SpreadsheetError(ValueError):
    """The file as a whole is unusable (wrong format, no header, too big)."""


class RowError(ValueError):
    """A single row is unusable; the rest of the import continues."""


# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------
def _money_format(currency: str) -> str:
    exp = exponent(currency)
    return "0." + "0" * exp if exp else "0"


def _new_sheet(currency: str):
    wb = Workbook()
    ws = wb.active
    ws.title = "Products"
    ws.append(COLUMNS)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for index, column in enumerate(COLUMNS, start=1):
        ws.column_dimensions[get_column_letter(index)].width = COLUMN_WIDTHS[column]
    ws.freeze_panes = "A2"
    return wb, ws


def _append(ws, values: list, currency: str) -> None:
    ws.append(values)
    for column in MONEY_COLUMNS:
        ws.cell(row=ws.max_row, column=COLUMNS.index(column) + 1).number_format = _money_format(
            currency
        )


def _save(wb) -> bytes:
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def export_products(queryset, *, currency: str = "ETB") -> bytes:
    """All products in ``queryset`` as an .xlsx workbook."""
    wb, ws = _new_sheet(currency)
    for p in queryset.select_related("category", "supplier"):
        _append(
            ws,
            [
                p.sku,
                p.name,
                p.barcode,
                p.category.name if p.category_id else "",
                p.supplier.name if p.supplier_id else "",
                p.unit,
                to_major(p.purchase_price, currency),
                to_major(p.selling_price, currency),
                p.min_stock_alert,
                p.status,
            ],
            currency,
        )
    return _save(wb)


def import_template(*, currency: str = "ETB") -> bytes:
    """The expected header plus one example row, for shops starting from scratch."""
    wb, ws = _new_sheet(currency)
    _append(
        ws,
        [
            "SKU-001",
            "Example product — replace this row",
            "6001234567890",
            "Beverages",
            "Acme Distributors",
            "pcs",
            to_major(9000, currency),
            to_major(15000, currency),
            5,
            "active",
        ],
        currency,
    )
    return _save(wb)


# --------------------------------------------------------------------------
# Import
# --------------------------------------------------------------------------
#: Everything a number can't contain — strips "Br", "$" and stray spaces so a
#: price pasted as "Br 1,500.00" still imports.
_NUMERIC_JUNK = re.compile(r"[^\d.\-]")


def _text(value) -> str:
    """Cell -> trimmed string.

    Excel hands numeric-looking cells back as floats, so a SKU or barcode typed
    as 12345 must not become "12345.0".
    """
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def _limited(value, *, field: str, required: bool = False) -> str:
    text = _text(value)
    if required and not text:
        raise RowError(f"{field} is required")
    limit = MAX_LENGTHS[field]
    if len(text) > limit:
        raise RowError(f"{field} is longer than {limit} characters")
    return text


def _decimal(value, *, field: str) -> Decimal:
    raw = _text(value)
    try:
        return Decimal(_NUMERIC_JUNK.sub("", raw.replace(",", "")))
    except InvalidOperation:
        raise RowError(f"{field}: '{raw}' is not a number") from None


def _money(value, *, field: str, currency: str) -> int:
    if _text(value) == "":
        return 0
    minor = to_minor(_decimal(value, field=field), currency)
    if minor < 0:
        raise RowError(f"{field} cannot be negative")
    return minor


def _count(value, *, field: str) -> int:
    if _text(value) == "":
        return 0
    number = int(_decimal(value, field=field).to_integral_value(rounding=ROUND_HALF_UP))
    if number < 0:
        raise RowError(f"{field} cannot be negative")
    return number


def _status(value) -> str:
    raw = _text(value)
    status = raw.lower() or Product.Status.ACTIVE
    if status not in Product.Status.values:
        allowed = " or ".join(Product.Status.values)
        raise RowError(f"status: '{raw}' must be {allowed}")
    return status


def _related(model, cache: dict, value, *, shop, field: str):
    """Look a category/supplier up by name, creating it on first sight."""
    name = _limited(value, field=field)
    if not name:
        return None
    key = name.casefold()
    if key not in cache:
        cache[key] = model.objects.filter(shop=shop, name__iexact=name).first() or (
            model.objects.create(shop=shop, name=name)
        )
    return cache[key]


def _shop_currency(shop) -> str:
    settings = getattr(shop, "settings", None)
    return settings.currency if settings else "ETB"


def _open_sheet(file_obj):
    try:
        wb = load_workbook(file_obj, data_only=True)
    except (InvalidFileException, BadZipFile, KeyError, OSError, TypeError, ValueError) as exc:
        raise SpreadsheetError(
            "Couldn't read that file. Save it from Excel as .xlsx and try again."
        ) from exc
    ws = wb.active
    if ws is None:
        raise SpreadsheetError("The workbook has no sheets.")
    return ws


def import_products(file_obj, *, shop, currency: str | None = None) -> dict:
    """Upsert products from an .xlsx file, keyed on SKU within the shop."""
    currency = currency or _shop_currency(shop)
    ws = _open_sheet(file_obj)

    rows = ws.iter_rows(values_only=True)
    header = [_text(h).lower() for h in next(rows, ())]
    idx = {column: header.index(column) for column in COLUMNS if column in header}
    if "sku" not in idx:
        raise SpreadsheetError(
            "The first row must be a header with at least a 'sku' column. "
            "Download the template to see the expected format."
        )

    def cell(row, column):
        j = idx.get(column)
        return row[j] if j is not None and j < len(row) else None

    categories: dict[str, Category] = {}
    suppliers: dict[str, Supplier] = {}
    created = updated = skipped = 0
    errors: list[dict] = []

    def fail(line: int, message: str) -> None:
        nonlocal skipped
        skipped += 1
        if len(errors) < MAX_ERRORS:
            errors.append({"row": line, "error": message})

    processed = 0
    for line, row in enumerate(rows, start=2):
        if row is None or all(_text(c) == "" for c in row):
            continue
        if processed >= MAX_ROWS:
            # Counting real rows beats trusting ws.max_row, which Excel inflates
            # when trailing rows carry nothing but formatting.
            skipped += 1 + sum(1 for rest in rows if any(_text(c) != "" for c in rest))
            errors.append(
                {
                    "row": line,
                    "error": f"Import stopped at {MAX_ROWS:,} rows. "
                    "Split the file and import the rest.",
                }
            )
            break
        processed += 1
        try:
            with transaction.atomic():
                sku = _limited(cell(row, "sku"), field="sku", required=True)
                defaults = {
                    "name": _limited(cell(row, "name"), field="name") or sku,
                    "barcode": _limited(cell(row, "barcode"), field="barcode"),
                    "unit": _limited(cell(row, "unit"), field="unit") or "pcs",
                    "purchase_price": _money(
                        cell(row, "purchase_price"), field="purchase_price", currency=currency
                    ),
                    "selling_price": _money(
                        cell(row, "selling_price"), field="selling_price", currency=currency
                    ),
                    "min_stock_alert": _count(
                        cell(row, "min_stock_alert"), field="min_stock_alert"
                    ),
                    "status": _status(cell(row, "status")),
                    # Resolved last so a rejected row never leaves a stray
                    # category or supplier behind.
                    "category": _related(
                        Category, categories, cell(row, "category"), shop=shop, field="category"
                    ),
                    "supplier": _related(
                        Supplier, suppliers, cell(row, "supplier"), shop=shop, field="supplier"
                    ),
                }
                _, was_created = Product.objects.update_or_create(
                    shop=shop, sku=sku, defaults=defaults
                )
        except RowError as exc:
            fail(line, str(exc))
            continue
        except DatabaseError:
            # The savepoint rolled back, so anything cached from this row is gone.
            categories.clear()
            suppliers.clear()
            fail(line, "Could not be saved.")
            continue
        created += int(was_created)
        updated += int(not was_created)

    return {"created": created, "updated": updated, "skipped": skipped, "errors": errors}
