"""Product .xlsx import/export.

The sheet is a human-facing surface, so money columns hold **major** units
(``150.00``) rather than the integer minor units we store (plan §3.5). Values
pass through ``apps.common.money`` in both directions, so a round-trip is exact
and never introduces float error.

Import is row-tolerant on purpose: one unusable row is reported and skipped,
the rest still land. Only a file we can't read at all raises SpreadsheetError.

Because import upserts on SKU, a sheet that reuses an existing SKU overwrites an
unrelated product, and a quantity on that row adds stock to it. ``dry_run=True``
therefore plans the whole import without writing anything and reports both as
``conflicts``, so the UI can show them and ask before any row lands.
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
from apps.inventory.models import InventoryTransaction
from apps.inventory.services import record_transaction
from apps.purchases.services import create_purchase

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
    "opening_stock",
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
    "opening_stock": 14,
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
#: Same reasoning for the dry run's collision report; ``updated`` keeps the total.
MAX_CONFLICTS = 50
#: And for the list of products it would add; ``created`` keeps the total.
MAX_CREATIONS = 50

#: Scalar fields a dry run compares against the existing product. Stock is absent
#: on purpose (the ledger owns it) and so is ``sku`` (it is what we matched on).
DIFF_FIELDS = (
    "name",
    "barcode",
    "unit",
    "purchase_price",
    "selling_price",
    "min_stock_alert",
    "status",
)
#: Diffed by name rather than by id, so "Beverages -> Stationery" reads plainly.
DIFF_RELATED = ("category", "supplier")


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
                # Current stock, so importing this file into another shop brings
                # the catalogue over complete. Importing it back into *this*
                # shop would add that stock a second time, since import stocks
                # in every row that carries a quantity — the dry run reports
                # exactly that, so the user sees it before confirming.
                p.stock_cached,
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
            12,
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


def _related(model, cache: dict, name: str, *, shop):
    """Look a category/supplier up by name, creating it on first sight."""
    if not name:
        return None
    key = name.casefold()
    if key not in cache:
        cache[key] = model.objects.filter(shop=shop, name__iexact=name).first() or (
            model.objects.create(shop=shop, name=name)
        )
    return cache[key]


def _parse_row(cell, *, currency) -> tuple[str, dict, dict, int]:
    """One sheet row -> (sku, scalar fields, related names, opening stock).

    Pure: it validates and converts but touches neither the database nor the
    category/supplier caches, so a row rejected here can leave nothing behind
    and a dry run can plan it without writing.
    """
    sku = _limited(cell("sku"), field="sku", required=True)
    fields = {
        "name": _limited(cell("name"), field="name") or sku,
        "barcode": _limited(cell("barcode"), field="barcode"),
        "unit": _limited(cell("unit"), field="unit") or "pcs",
        "purchase_price": _money(cell("purchase_price"), field="purchase_price", currency=currency),
        "selling_price": _money(cell("selling_price"), field="selling_price", currency=currency),
        "min_stock_alert": _count(cell("min_stock_alert"), field="min_stock_alert"),
        "status": _status(cell("status")),
        # Stock is never written directly — it is derived from the ledger
        # (plan §3.2), so it is not one of the fields we upsert.
    }
    related = {
        "category": _limited(cell("category"), field="category"),
        "supplier": _limited(cell("supplier"), field="supplier"),
    }
    return sku, fields, related, _count(cell("opening_stock"), field="opening_stock")


def _display(field: str, value, *, currency: str) -> str:
    """A field value as the sheet shows it, so the preview reads like Excel."""
    if field in MONEY_COLUMNS:
        return str(to_major(value, currency))
    return str(value)


def _changes(before: dict, fields: dict, related: dict, *, currency: str) -> list[dict]:
    """What this row would overwrite on an existing product — only what differs.

    ``before`` holds the current values in the same shape ``_parse_row`` returns,
    so a product already in the database and a row planned earlier in the same
    sheet compare identically.
    """
    changes = []
    for field in DIFF_FIELDS:
        old, new = before["fields"][field], fields[field]
        if old != new:
            changes.append(
                {
                    "field": field,
                    "from": _display(field, old, currency=currency),
                    "to": _display(field, new, currency=currency),
                }
            )
    for field in DIFF_RELATED:
        old, new = before["related"][field], related[field]
        # Names are matched case-insensitively on the way in, so diff them that way.
        if old.casefold() != new.casefold():
            changes.append({"field": field, "from": old, "to": new})
    return changes


def _creation(line: int, sku: str, fields: dict, related: dict, opening: int, *, currency) -> dict:
    """A row the import would add, in the units the sheet shows."""
    return {
        "row": line,
        "sku": sku,
        "name": fields["name"],
        "category": related["category"],
        "supplier": related["supplier"],
        "purchase_price": _display("purchase_price", fields["purchase_price"], currency=currency),
        "selling_price": _display("selling_price", fields["selling_price"], currency=currency),
        "opening_stock": opening,
    }


def _snapshot(product, *, currency: str) -> dict:
    """An existing product in ``_parse_row`` shape, ready to diff against a row."""
    return {
        "fields": {field: getattr(product, field) for field in DIFF_FIELDS},
        "related": {
            field: (obj.name if (obj := getattr(product, field)) else "") for field in DIFF_RELATED
        },
    }


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


#: Shown on the purchase the import books, so the row is self-explaining later.
IMPORT_PURCHASE_NOTE = "Stock from product import"


@transaction.atomic
def _post_import_purchase(lines: list[dict], *, shop, user) -> tuple[int, int]:
    """Stock in every row that carried a quantity, as one purchase for the import.

    Recorded as a purchase rather than a bare adjustment, so the stock has
    provenance: it appears in purchase history, and each ledger row carries its
    unit cost and points back at the purchase. One purchase per import run, its
    total the sum of ``unit cost x quantity`` over every line.

    A purchase has a single supplier, so it is set only when the whole sheet
    named one; a sheet spanning several leaves it blank rather than crediting
    the stock to a supplier it did not come from.

    The sheet has no payment column, so the purchase is booked as **already
    paid**: the stock is on the shelf, and inventing a payable would misstate
    what the shop owes. The trade-off is a cash-out entry on the import date.

    All-or-nothing: a half-stocked import is harder to reason about than one
    where the products landed and their quantities plainly did not.

    Returns ``(products stocked, purchases created)``.
    """
    if user is None:
        # Purchase.user is non-null, so a caller without one (seeding, shell)
        # keeps the plain adjustment. Stock lands either way.
        for line in lines:
            record_transaction(
                product=line["product"],
                quantity=line["quantity"],
                type=InventoryTransaction.Type.ADJUSTMENT,
                notes="Opening stock",
            )
        return len(lines), 0

    seen = {line["supplier"].id if line["supplier"] else None for line in lines}
    supplier = lines[0]["supplier"] if len(seen) == 1 else None

    create_purchase(
        shop=shop,
        user=user,
        supplier=supplier,
        items=lines,
        # Equal to the total create_purchase derives, so the purchase is paid in
        # full and no supplier payable is invented.
        amount_paid=sum(line["unit_cost"] * line["quantity"] for line in lines),
        notes=IMPORT_PURCHASE_NOTE,
    )
    return len(lines), 1


def import_products(
    file_obj, *, shop, currency: str | None = None, user=None, dry_run: bool = False
) -> dict:
    """Upsert products from an .xlsx file, keyed on SKU within the shop.

    ``opening_stock`` stocks the row in, whether the product is new or already
    in the catalogue (where it reads as a restock). Every such row goes onto one
    paid purchase for the import (see ``_post_import_purchase``), so the stock
    shows up in purchase history with its cost.

    Nothing therefore stops importing the same quantities twice - the dry run
    exists to make that visible before it happens, and it reports the stock each
    row would add. Callers must show that plan.

    With ``dry_run=True`` nothing is written: the same rows are parsed and
    validated, and the whole plan comes back — ``creations`` for the products it
    would add, ``conflicts`` for every SKU that already exists (or repeats
    within the sheet) with the exact fields it would overwrite, and ``errors``
    for the rows it would reject. The caller shows that plan and re-submits the
    file to commit it. Both lists are capped; the counts beside them are not.
    """
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

    def cell_reader(row):
        def cell(column):
            j = idx.get(column)
            return row[j] if j is not None and j < len(row) else None

        return cell

    categories: dict[str, Category] = {}
    suppliers: dict[str, Supplier] = {}
    created = updated = skipped = stock_set = 0
    errors: list[dict] = []
    conflicts: list[dict] = []
    creations: list[dict] = []
    #: Total rows that would overwrite something, of which ``conflicts`` is a
    #: capped sample. Not the same as ``updated``: re-importing an untouched
    #: export matches every SKU but changes nothing, and warning about that
    #: would train people to click through the warning that matters.
    conflict_count = 0
    #: The subset of those that rewrite a field, as opposed to only adding stock.
    #: This is the destructive number, and the one the UI warns in red about.
    overwrite_count = 0
    #: What the import's purchase would come to: cost x quantity, summed over
    #: every row carrying a quantity. Reported so the preview can show the
    #: figure rather than leave it to be discovered afterwards.
    purchase_total = 0
    #: Opening stock for the products this run creates, posted after the loop.
    opening: list[dict] = []
    purchases = 0

    # One query up front beats a lookup per row, and the catalogue is bounded by
    # the shop's product count. Only a dry run needs the "before" values.
    planned: dict[str, dict] = {}
    if dry_run:
        planned = {
            product.sku: dict(_snapshot(product, currency=currency), row=None, name=product.name)
            for product in Product.objects.filter(shop=shop).select_related("category", "supplier")
        }

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
            cell = cell_reader(row)
            if dry_run:
                sku, fields, related, opening_stock = _parse_row(cell, currency=currency)
                before = planned.get(sku)
                stock_set += bool(opening_stock)
                purchase_total += fields["purchase_price"] * opening_stock
                if before is None:
                    created += 1
                    if len(creations) < MAX_CREATIONS:
                        creations.append(
                            _creation(line, sku, fields, related, opening_stock, currency=currency)
                        )
                else:
                    updated += 1
                    changes = _changes(before, fields, related, currency=currency)
                    # Adding stock counts even when no field moves: re-importing
                    # an untouched export changes nothing *except* the quantity,
                    # which is exactly the surprise worth warning about.
                    if changes or opening_stock:
                        conflict_count += 1
                        overwrite_count += bool(changes)
                        if len(conflicts) < MAX_CONFLICTS:
                            conflicts.append(
                                {
                                    "row": line,
                                    "sku": sku,
                                    "existing_name": before["name"],
                                    # Set when the collision is with an earlier row
                                    # of this sheet rather than with the catalogue.
                                    "duplicate_of_row": before["row"],
                                    "opening_stock": opening_stock,
                                    "changes": changes,
                                }
                            )
                # Later rows collide with this one, exactly as the real import
                # would have them collide with the product it just wrote.
                planned[sku] = {
                    "fields": fields,
                    "related": related,
                    "row": line,
                    "name": fields["name"],
                }
                continue

            with transaction.atomic():
                sku, fields, related, opening_stock = _parse_row(cell, currency=currency)
                # Resolved after parsing, so a rejected row never leaves a stray
                # category or supplier behind.
                defaults = dict(
                    fields,
                    category=_related(Category, categories, related["category"], shop=shop),
                    supplier=_related(Supplier, suppliers, related["supplier"], shop=shop),
                )
                product, was_created = Product.objects.update_or_create(
                    shop=shop, sku=sku, defaults=defaults
                )
                if opening_stock:
                    # Held back until every row is in: the import books one
                    # purchase, which can only be written once the whole sheet
                    # is known.
                    opening.append(
                        {
                            "product": product,
                            "quantity": opening_stock,
                            "unit_cost": fields["purchase_price"],
                            "supplier": defaults["supplier"],
                        }
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

    if opening:
        try:
            stock_set, purchases = _post_import_purchase(opening, shop=shop, user=user)
        except DatabaseError:
            # The products themselves are already saved and correct; only their
            # opening quantity is missing, and a stock adjustment can add it.
            errors.append(
                {"row": 0, "error": "Products were imported, but their opening stock was not."}
            )

    return {
        "dry_run": dry_run,
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "stock_set": stock_set,
        "errors": errors,
        "conflicts": conflicts,
        "conflict_count": conflict_count,
        "overwrite_count": overwrite_count,
        "purchase_total": _display("purchase_price", purchase_total, currency=currency),
        "creations": creations,
        "purchases": purchases,
    }
