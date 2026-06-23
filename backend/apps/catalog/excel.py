"""Product .xlsx import/export.

Price columns hold **integer minor units** (plan §3.5) so a round-trip is exact
and never introduces float error.
"""

import io

from openpyxl import Workbook, load_workbook

from .models import Category, Product

COLUMNS = [
    "sku",
    "name",
    "barcode",
    "category",
    "unit",
    "purchase_price",
    "selling_price",
    "min_stock_alert",
    "status",
]


def export_products(queryset) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Products"
    ws.append(COLUMNS)
    for p in queryset:
        ws.append(
            [
                p.sku,
                p.name,
                p.barcode,
                p.category.name if p.category_id else "",
                p.unit,
                p.purchase_price,
                p.selling_price,
                p.min_stock_alert,
                p.status,
            ]
        )
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _to_int(value, default: int = 0) -> int:
    if value in (None, ""):
        return default
    return int(float(value))


def import_products(file_obj, *, shop) -> dict:
    wb = load_workbook(file_obj, data_only=True)
    ws = wb.active
    rows = ws.iter_rows(values_only=True)

    header = [str(h).strip().lower() if h is not None else "" for h in next(rows, [])]
    idx = {col: header.index(col) for col in COLUMNS if col in header}
    if "sku" not in idx:
        return {"created": 0, "updated": 0, "errors": [{"row": 1, "error": "missing 'sku' column"}]}

    def cell(row, col, default=""):
        j = idx.get(col)
        if j is None or j >= len(row) or row[j] is None:
            return default
        return row[j]

    created = updated = 0
    errors: list[dict] = []
    for line, row in enumerate(rows, start=2):
        if row is None or all(c is None for c in row):
            continue
        sku = str(cell(row, "sku")).strip()
        if not sku:
            errors.append({"row": line, "error": "missing sku"})
            continue

        category = None
        category_name = str(cell(row, "category")).strip()
        if category_name:
            category, _ = Category.objects.get_or_create(shop=shop, name=category_name)

        defaults = {
            "name": str(cell(row, "name")).strip() or sku,
            "barcode": str(cell(row, "barcode")).strip(),
            "category": category,
            "unit": str(cell(row, "unit", "pcs")).strip() or "pcs",
            "purchase_price": _to_int(cell(row, "purchase_price")),
            "selling_price": _to_int(cell(row, "selling_price")),
            "min_stock_alert": _to_int(cell(row, "min_stock_alert")),
            "status": str(cell(row, "status", "active")).strip() or "active",
        }
        _, was_created = Product.objects.update_or_create(shop=shop, sku=sku, defaults=defaults)
        created += int(was_created)
        updated += int(not was_created)

    return {"created": created, "updated": updated, "errors": errors}
