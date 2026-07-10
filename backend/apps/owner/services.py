"""Owner console aggregations (plan §11 Phase 6).

These are the only queries allowed to span shops (plan §3.1), and they span
exactly the set of shops the requesting user owns. Money values may mix
currencies across shops; each per-shop block carries its own currency and the
frontend labels totals per shop rather than pretending one combined currency.
"""

from __future__ import annotations

from datetime import timedelta

from django.db.models import BigIntegerField, ExpressionWrapper, F, Sum
from django.utils import timezone

from apps.catalog.models import Product
from apps.expenses.models import Expense
from apps.inventory.models import InventoryTransaction
from apps.reports.services import _datetime_range
from apps.reports.services import dashboard as shop_dashboard
from apps.sales.models import Sale, SaleItem

_LINE_COST = ExpressionWrapper(
    F("quantity") * F("product__purchase_price"), output_field=BigIntegerField()
)


def owned_shops(user):
    return user.owned_shops.filter(deleted_at__isnull=True).order_by("name")


def owner_dashboard(user) -> dict:
    """Per-shop headline numbers (reusing the shop dashboard service) plus a few
    cross-shop lists: low-stock alerts, latest expenses, latest stock movements."""
    shops = list(owned_shops(user))
    per_shop = []
    for shop in shops:
        data = shop_dashboard(shop)
        per_shop.append({"shop_id": str(shop.id), "shop_name": shop.name, **data})

    low_stock = [
        {
            "shop_name": p.shop.name,
            "product": p.name,
            "sku": p.sku,
            "stock": p.stock_cached,
            "min_alert": p.min_stock_alert,
        }
        for p in Product.objects.filter(
            shop__in=shops, stock_cached__lte=F("min_stock_alert")
        ).select_related("shop")[:20]
    ]

    recent_expenses = [
        {
            "shop_name": e.shop.name,
            "amount": e.amount,
            "currency": (e.shop.settings.currency if getattr(e.shop, "settings", None) else "USD"),
            "category": e.category.name if e.category else None,
            "by": e.user.full_name if e.user else None,
            "date": str(e.date),
        }
        for e in Expense.objects.filter(shop__in=shops)
        .select_related("shop", "shop__settings", "category", "user")
        .order_by("-created_at")[:10]
    ]

    stock_movements = [
        {
            "shop_name": t.shop.name,
            "product": t.product.name,
            "type": t.type,
            "quantity": t.quantity,
            "at": t.created_at.isoformat(),
        }
        for t in InventoryTransaction.objects.filter(shop__in=shops)
        .select_related("shop", "product")
        .order_by("-created_at")[:15]
    ]

    return {
        "shop_count": len(shops),
        "shops": per_shop,
        "low_stock_alerts": low_stock,
        "recent_expenses": recent_expenses,
        "stock_movements": stock_movements,
    }


def compare_shops(user, *, start=None, end=None) -> dict:
    """Side-by-side performance for a period, ranked by sales total."""
    end = end or timezone.now().date()
    start = start or (end - timedelta(days=29))
    range_start, range_end = _datetime_range(start, end)
    rows = []
    for shop in owned_shops(user):
        sales_qs = Sale.objects.filter(
            shop=shop,
            status=Sale.Status.COMPLETED,
            created_at__gte=range_start,
            created_at__lt=range_end,
        )
        revenue = sales_qs.aggregate(s=Sum("total"))["s"] or 0
        cogs = SaleItem.objects.filter(sale__in=sales_qs).aggregate(c=Sum(_LINE_COST))["c"] or 0
        expenses = (
            Expense.objects.filter(shop=shop, date__gte=start, date__lte=end).aggregate(
                s=Sum("amount")
            )["s"]
            or 0
        )
        settings = getattr(shop, "settings", None)
        rows.append(
            {
                "shop_id": str(shop.id),
                "shop_name": shop.name,
                "currency": settings.currency if settings else "USD",
                "sales_total": revenue,
                "sales_count": sales_qs.count(),
                "gross_profit": revenue - cogs,
                "expenses": expenses,
                "net_profit": revenue - cogs - expenses,
            }
        )
    rows.sort(key=lambda r: r["sales_total"], reverse=True)
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
    return {"period": {"start": str(start), "end": str(end)}, "shops": rows}
