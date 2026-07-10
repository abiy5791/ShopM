"""Report aggregations (plan §11 Phase 5). Every figure is derived from the
ledgers/tables so it ties out to the underlying data.

Reports return a uniform dict so the same JSON response and the PDF/XLSX
exporters can render any of them:

    {key, title, currency, summary:[{label,value,money}], columns:[...],
     rows:[[...]], money_columns:[idx,...]}
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.db.models import BigIntegerField, Count, ExpressionWrapper, F, Sum
from django.db.models.functions import TruncDate, TruncMonth, TruncWeek, TruncYear
from django.utils import timezone

from apps.catalog.models import Product
from apps.expenses.models import Expense
from apps.purchases.models import Purchase
from apps.sales.models import Payment, Sale, SaleItem

_LINE_COST = ExpressionWrapper(
    F("quantity") * F("product__purchase_price"), output_field=BigIntegerField()
)


def _datetime_range(start: date, end: date) -> tuple[datetime, datetime]:
    """Half-open [start, end] datetime bounds for filtering a DateTimeField by
    calendar date. Using gte/lt on the raw column (rather than `__date=`/
    `__date__gte`) lets Postgres use the plain (shop, -created_at) index instead
    of computing `created_at::date` per row."""
    tz = timezone.get_current_timezone()
    start_dt = timezone.make_aware(datetime.combine(start, time.min), tz)
    end_dt = timezone.make_aware(datetime.combine(end, time.min), tz) + timedelta(days=1)
    return start_dt, end_dt


def _currency(shop) -> str:
    settings = getattr(shop, "settings", None)
    return settings.currency if settings else "ETB"


def _completed_sales(shop):
    return Sale.objects.filter(shop=shop, status=Sale.Status.COMPLETED)


def _cogs(sale_qs) -> int:
    """Cost of goods sold for a set of sales (qty × current purchase price)."""
    return SaleItem.objects.filter(sale__in=sale_qs).aggregate(c=Sum(_LINE_COST))["c"] or 0


# ---------------------------------------------------------------- dashboard
def dashboard(shop) -> dict:
    today = timezone.now().date()
    day_start, day_end = _datetime_range(today, today)
    todays_sales = _completed_sales(shop).filter(created_at__gte=day_start, created_at__lt=day_end)
    sales_total = todays_sales.aggregate(s=Sum("total"))["s"] or 0
    sales_count = todays_sales.count()
    cogs = _cogs(todays_sales)
    gross_profit = sales_total - cogs
    expenses_total = (
        Expense.objects.filter(shop=shop, date=today).aggregate(s=Sum("amount"))["s"] or 0
    )
    net_profit = gross_profit - expenses_total

    cash_in = (
        Payment.objects.filter(shop=shop, method=Payment.Method.CASH)
        .exclude(sale__status=Sale.Status.VOIDED)
        .aggregate(s=Sum("amount"))["s"]
        or 0
    )
    cash_out = (Expense.objects.filter(shop=shop).aggregate(s=Sum("amount"))["s"] or 0) + (
        Purchase.objects.filter(shop=shop).aggregate(s=Sum("amount_paid"))["s"] or 0
    )

    month_start, _ = _datetime_range(today.replace(day=1), today.replace(day=1))
    best_sellers = list(
        SaleItem.objects.filter(
            sale__shop=shop,
            sale__status=Sale.Status.COMPLETED,
            sale__created_at__gte=month_start,
        )
        .values("name_snapshot")
        .annotate(quantity=Sum("quantity"))
        .order_by("-quantity")[:5]
    )
    recent_sales = list(
        _completed_sales(shop).order_by("-created_at").values("id", "total", "created_at")[:10]
    )

    return {
        "currency": _currency(shop),
        "today": {
            "sales_total": sales_total,
            "sales_count": sales_count,
            "expenses_total": expenses_total,
            "gross_profit": gross_profit,
            "net_profit": net_profit,
        },
        "low_stock_count": Product.objects.filter(
            shop=shop, stock_cached__lte=F("min_stock_alert")
        ).count(),
        "total_products": Product.objects.filter(shop=shop).count(),
        "cash_balance": cash_in - cash_out,
        "best_sellers": [
            {"name": b["name_snapshot"], "quantity": b["quantity"]} for b in best_sellers
        ],
        "recent_sales": [
            {"id": str(s["id"]), "total": s["total"], "created_at": s["created_at"].isoformat()}
            for s in recent_sales
        ],
    }


# ---------------------------------------------------------------- helpers
def _default_range(start: date | None, end: date | None) -> tuple[date, date]:
    end = end or timezone.now().date()
    start = start or (end - timedelta(days=29))
    return start, end


_TRUNC = {
    "daily": TruncDate,
    "weekly": TruncWeek,
    "monthly": TruncMonth,
    "yearly": TruncYear,
}


# ---------------------------------------------------------------- sales
def sales_report(shop, *, period="daily", start=None, end=None) -> dict:
    start, end = _default_range(start, end)
    trunc = _TRUNC.get(period, TruncDate)
    range_start, range_end = _datetime_range(start, end)
    qs = _completed_sales(shop).filter(created_at__gte=range_start, created_at__lt=range_end)
    grouped = (
        qs.annotate(bucket=trunc("created_at"))
        .values("bucket")
        .annotate(count=Count("id"), total=Sum("total"))
        .order_by("bucket")
    )
    rows = [[str(g["bucket"])[:10], g["count"], g["total"] or 0] for g in grouped]
    summary_total = qs.aggregate(s=Sum("total"))["s"] or 0
    summary_count = qs.count()
    return {
        "key": "sales",
        "title": f"Sales report ({period})",
        "currency": _currency(shop),
        "period": {"start": str(start), "end": str(end), "granularity": period},
        "summary": [
            {"label": "Total sales", "value": summary_total, "money": True},
            {"label": "Transactions", "value": summary_count, "money": False},
        ],
        "columns": ["Date", "Transactions", "Total"],
        "rows": rows,
        "money_columns": [2],
    }


# ---------------------------------------------------------------- inventory
def inventory_report(shop) -> dict:
    products = Product.objects.filter(shop=shop).order_by("name")
    rows = []
    valuation = 0
    low = out = 0
    for p in products:
        line_value = p.stock_cached * p.purchase_price
        valuation += line_value
        if p.stock_cached <= 0:
            out += 1
        elif p.stock_cached <= p.min_stock_alert:
            low += 1
        rows.append([p.name, p.sku, p.stock_cached, p.purchase_price, line_value])
    return {
        "key": "inventory",
        "title": "Inventory report",
        "currency": _currency(shop),
        "summary": [
            {"label": "Stock valuation", "value": valuation, "money": True},
            {"label": "Low stock", "value": low, "money": False},
            {"label": "Out of stock", "value": out, "money": False},
        ],
        "columns": ["Product", "SKU", "Stock", "Unit cost", "Valuation"],
        "rows": rows,
        "money_columns": [3, 4],
    }


# ---------------------------------------------------------------- profit
def profit_report(shop, *, start=None, end=None) -> dict:
    start, end = _default_range(start, end)
    range_start, range_end = _datetime_range(start, end)
    qs = _completed_sales(shop).filter(created_at__gte=range_start, created_at__lt=range_end)
    revenue = qs.aggregate(s=Sum("total"))["s"] or 0
    cogs = _cogs(qs)
    gross = revenue - cogs
    expenses = (
        Expense.objects.filter(shop=shop, date__gte=start, date__lte=end).aggregate(
            s=Sum("amount")
        )["s"]
        or 0
    )
    net = gross - expenses
    return {
        "key": "profit",
        "title": "Profit report",
        "currency": _currency(shop),
        "period": {"start": str(start), "end": str(end)},
        "summary": [
            {"label": "Net profit", "value": net, "money": True},
            {
                "label": "Gross margin %",
                "value": (gross * 100 // revenue) if revenue else 0,
                "money": False,
            },
        ],
        "columns": ["Metric", "Amount"],
        "rows": [
            ["Revenue", revenue],
            ["Cost of goods sold", cogs],
            ["Gross profit", gross],
            ["Expenses", expenses],
            ["Net profit", net],
        ],
        "money_columns": [1],
    }


# ---------------------------------------------------------------- cashflow
def cashflow_report(shop, *, start=None, end=None) -> dict:
    start, end = _default_range(start, end)
    range_start, range_end = _datetime_range(start, end)
    cash_in = (
        Payment.objects.filter(
            shop=shop,
            method=Payment.Method.CASH,
            received_at__gte=range_start,
            received_at__lt=range_end,
        )
        .exclude(sale__status=Sale.Status.VOIDED)
        .aggregate(s=Sum("amount"))["s"]
        or 0
    )
    expenses = (
        Expense.objects.filter(shop=shop, date__gte=start, date__lte=end).aggregate(
            s=Sum("amount")
        )["s"]
        or 0
    )
    purchases_paid = (
        Purchase.objects.filter(shop=shop, date__gte=start, date__lte=end).aggregate(
            s=Sum("amount_paid")
        )["s"]
        or 0
    )
    net = cash_in - expenses - purchases_paid
    return {
        "key": "cashflow",
        "title": "Cash flow report",
        "currency": _currency(shop),
        "period": {"start": str(start), "end": str(end)},
        "summary": [{"label": "Net cash flow", "value": net, "money": True}],
        "columns": ["Metric", "Amount"],
        "rows": [
            ["Cash received", cash_in],
            ["Expenses paid", expenses],
            ["Purchases paid", purchases_paid],
            ["Net cash flow", net],
        ],
        "money_columns": [1],
    }
