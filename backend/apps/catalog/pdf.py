"""The product catalogue as a printable PDF.

The .xlsx export is a round-trip format (what you export, you can re-import), so
it carries only the importable columns. The PDF is a *document* — a price list to
print or send — so it also shows stock and is laid out by the reports renderer,
giving it the same header, pagination and footer as every other document here.
"""

from apps.reports.exporters import to_pdf

COLUMNS = ["Product", "SKU", "Category", "Unit", "Cost", "Price", "Stock", "Status"]
MONEY_COLUMNS = [4, 5]


def catalogue_report(queryset, *, currency: str) -> dict:
    """Shape the catalogue like a report dict, for the shared PDF/XLSX renderers."""
    rows = []
    stock_value = 0
    low_stock = 0
    for product in queryset.select_related("category"):
        rows.append(
            [
                product.name,
                product.sku,
                product.category.name if product.category_id else "—",
                product.unit,
                product.purchase_price,
                product.selling_price,
                product.stock_cached,
                product.status,
            ]
        )
        stock_value += product.stock_cached * product.purchase_price
        low_stock += int(product.is_low_stock)

    return {
        "key": "products",
        "title": "Product catalogue",
        "currency": currency,
        "summary": [
            {"label": "Products", "value": len(rows), "money": False},
            {"label": "Stock value", "value": stock_value, "money": True},
            {"label": "Low stock", "value": low_stock, "money": False},
        ],
        "columns": COLUMNS,
        "rows": rows,
        "money_columns": MONEY_COLUMNS,
    }


def export_products_pdf(queryset, *, shop_name: str = "", currency: str = "ETB") -> bytes:
    return to_pdf(catalogue_report(queryset, currency=currency), shop_name=shop_name)
