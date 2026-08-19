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
from django.db.models.functions import TruncDate
from django.utils import timezone

from apps.activity.models import ActivityLog
from apps.catalog.models import Product
from apps.common import ethiopian
from apps.customers.models import Customer
from apps.expenses.models import Expense
from apps.purchases.models import Purchase
from apps.sales.models import Payment, Sale, SaleItem

_LINE_COST = ExpressionWrapper(
    F("quantity") * F("product__purchase_price"), output_field=BigIntegerField()
)


def _datetime_range(start: date, end: date) -> tuple[datetime, datetime]:
    """Half-open [start, end] datetime bounds for filtering a DateTimeField by
    calendar date. Using gte/lt on the raw column (rather than `__date=`/
    `__date__gte`) lets Postgres use the plain (shop, -occurred_at) index instead
    of computing `occurred_at::date` per row.

    Sales are filtered on ``occurred_at`` — the day the sale HAPPENED — not on
    ``created_at``, so a sale an owner recorded late still counts towards the day
    it belongs to (apps.sales.backdating)."""
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


def _expense_charge(shop, day: date) -> dict:
    """Expenses to charge against a single day.

    One-time expenses dated that day are charged in full; each monthly expense
    (salary, rent) is entered once for its month and charged as its per-day share
    (amount ÷ days in that month). This spreads fixed overhead across the month
    per the accounting matching principle, so a single day isn't sunk by a whole
    month's cost. Used by both the daily dashboard and the My Day close.
    """
    one_time = list(
        Expense.objects.filter(
            shop=shop, date=day, recurrence=Expense.Recurrence.ONE_TIME
        ).select_related("category")
    )
    direct_total = sum(e.amount for e in one_time)

    # Prorate over the ETHIOPIAN month the day falls in — 30 days for months
    # 1–12, 5/6 for Pagumē — since the shop runs on the Ethiopian calendar and
    # there is no 31-day month. Monthly expenses are grouped by that same
    # Ethiopian month (via its Gregorian bounds), not the Gregorian month.
    e_year, e_month, _ = ethiopian.to_ethiopian(day)
    days_in_month = ethiopian.month_length(e_year, e_month)
    g_start, g_end = ethiopian.month_bounds_gregorian(day)
    monthly = list(
        Expense.objects.filter(
            shop=shop,
            recurrence=Expense.Recurrence.MONTHLY,
            date__gte=g_start,
            date__lte=g_end,
        ).select_related("category")
    )
    monthly_items = [
        {
            "category": e.category.name if e.category else "Uncategorized",
            "description": e.description,
            "amount": e.amount,
            "per_day": round(e.amount / days_in_month),
        }
        for e in monthly
    ]
    monthly_prorated = sum(m["per_day"] for m in monthly_items)

    return {
        "one_time": one_time,
        "direct_total": direct_total,
        "monthly_items": monthly_items,
        "monthly_prorated": monthly_prorated,
        "monthly_full": sum(e.amount for e in monthly),
        "charge_total": direct_total + monthly_prorated,
    }


# ---------------------------------------------------------------- day book
def day_book(shop, on_date: date | None = None) -> dict:
    """Everything that happened on a single day — the owner's "My Day" screen.

    One round-trip so the day can be reviewed and printed as an end-of-day
    close: headline totals, payment-method split, every sale, every expense, and
    the day's activity trail. All figures are scoped to `on_date` in the shop's
    timezone and tie out to the same ledgers the reports use.
    """
    day = on_date or timezone.now().date()
    day_start, day_end = _datetime_range(day, day)

    sales_qs = (
        _completed_sales(shop)
        .filter(occurred_at__gte=day_start, occurred_at__lt=day_end)
        .select_related("cashier", "customer")
        .annotate(item_count=Count("items"))
        .order_by("occurred_at")
    )
    agg = sales_qs.aggregate(
        total=Sum("total"),
        subtotal=Sum("subtotal"),
        discount=Sum("discount"),
        tax=Sum("tax"),
    )
    sales_total = agg["total"] or 0  # what customers paid, tax included
    discount_total = agg["discount"] or 0
    tax_total = agg["tax"] or 0
    # Revenue that is actually the shop's — tax is collected on the state's
    # behalf and remitted, so it is never part of sales revenue or profit.
    net_sales = (agg["subtotal"] or 0) - discount_total
    sales_count = sales_qs.count()
    items_sold = SaleItem.objects.filter(sale__in=sales_qs).aggregate(q=Sum("quantity"))["q"] or 0
    gross_profit = net_sales - _cogs(sales_qs)

    # Best-selling products of the day (by units), with the revenue they brought.
    top_products = [
        {"name": r["name_snapshot"], "quantity": r["quantity"], "revenue": r["revenue"] or 0}
        for r in SaleItem.objects.filter(sale__in=sales_qs)
        .values("name_snapshot")
        .annotate(quantity=Sum("quantity"), revenue=Sum("line_total"))
        .order_by("-quantity")[:5]
    ]

    # Expenses charged to this day: one-time in full + monthly prorated per-day.
    charge = _expense_charge(shop, day)
    expenses_total = charge["charge_total"]
    net_profit = gross_profit - expenses_total

    # Payments TOWARD today's sales, split by method — this reconciles with the
    # day's sales total. Standalone credit settlements (a customer paying off an
    # older debt) are money in today but not from today's sales, so they are
    # excluded here and reported separately below.
    method_rows = (
        Payment.objects.filter(
            sale__in=sales_qs, received_at__gte=day_start, received_at__lt=day_end
        )
        .values("method")
        .annotate(total=Sum("amount"))
        .order_by("-total")
    )
    by_method = [{"method": r["method"], "total": r["total"] or 0} for r in method_rows]
    cash_received = next((r["total"] for r in by_method if r["method"] == Payment.Method.CASH), 0)

    # Credit settlements received today (standalone payments, not tied to a sale).
    settlements_received = (
        Payment.objects.filter(
            shop=shop,
            sale__isnull=True,
            received_at__gte=day_start,
            received_at__lt=day_end,
        ).aggregate(s=Sum("amount"))["s"]
        or 0
    )

    sales = [
        {
            "id": str(s.id),
            "occurred_at": s.occurred_at.isoformat(),
            "total": s.total,
            "item_count": s.item_count,
            "cashier_name": s.cashier.full_name if s.cashier else "",
            "customer_name": s.customer.name if s.customer else None,
        }
        for s in sales_qs
    ]
    expenses = [
        {
            "category": e.category.name if e.category else "Uncategorized",
            "description": e.description,
            "amount": e.amount,
        }
        for e in sorted(charge["one_time"], key=lambda e: -e.amount)
    ]
    activity = [
        {
            "created_at": a.created_at.isoformat(),
            "action": a.action,
            "user_email": a.user.email if a.user else None,
            "level": a.level,
        }
        for a in ActivityLog.objects.filter(
            shop=shop, created_at__gte=day_start, created_at__lt=day_end
        )
        .select_related("user")
        .order_by("-created_at")[:100]
    ]

    return {
        "date": str(day),
        "date_ethiopian": ethiopian.format_ethiopian(day),
        "currency": _currency(shop),
        "summary": {
            "sales_total": sales_total,
            "net_sales": net_sales,
            "tax_total": tax_total,
            "sales_count": sales_count,
            "items_sold": items_sold,
            "gross_profit": gross_profit,
            "expenses_total": expenses_total,
            "direct_expenses": charge["direct_total"],
            "monthly_prorated": charge["monthly_prorated"],
            "monthly_full": charge["monthly_full"],
            "net_profit": net_profit,
            "cash_received": cash_received,
            "settlements_received": settlements_received,
            "discount_total": discount_total,
        },
        "by_method": by_method,
        "top_products": top_products,
        "sales": sales,
        "expenses": expenses,
        "monthly_expenses": charge["monthly_items"],
        "activity": activity,
    }


# ---------------------------------------------------------------- dashboard
def dashboard(shop, on_date: date | None = None) -> dict:
    today = on_date or timezone.now().date()
    day_start, day_end = _datetime_range(today, today)
    todays_sales = _completed_sales(shop).filter(
        occurred_at__gte=day_start, occurred_at__lt=day_end
    )
    agg = todays_sales.aggregate(
        total=Sum("total"), subtotal=Sum("subtotal"), discount=Sum("discount")
    )
    sales_total = agg["total"] or 0
    sales_count = todays_sales.count()
    cogs = _cogs(todays_sales)
    # Profit is on the shop's own revenue only — tax collected is excluded.
    net_sales = (agg["subtotal"] or 0) - (agg["discount"] or 0)
    gross_profit = net_sales - cogs
    # Same fair daily charge as My Day: one-time today + monthly prorated per-day.
    expenses_total = _expense_charge(shop, today)["charge_total"]
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
            sale__occurred_at__gte=month_start,
        )
        .values("name_snapshot")
        .annotate(quantity=Sum("quantity"))
        .order_by("-quantity")[:5]
    )
    recent_sales = list(
        _completed_sales(shop).order_by("-occurred_at").values("id", "total", "occurred_at")[:10]
    )

    # Sales totals for the 7 days ending on `today` (sparkline, v2 plan §4).
    week_start = today - timedelta(days=6)
    ws, we = _datetime_range(week_start, today)
    weekly = (
        _completed_sales(shop)
        .filter(occurred_at__gte=ws, occurred_at__lt=we)
        .annotate(bucket=TruncDate("occurred_at"))
        .values("bucket")
        .annotate(total=Sum("total"))
    )
    weekly_map = {g["bucket"]: g["total"] or 0 for g in weekly}
    week_series = [
        {
            "date": str(week_start + timedelta(days=i)),
            "total": weekly_map.get(week_start + timedelta(days=i), 0),
        }
        for i in range(7)
    ]

    return {
        "currency": _currency(shop),
        "date": str(today),
        "week_series": week_series,
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
            {"id": str(s["id"]), "total": s["total"], "occurred_at": s["occurred_at"].isoformat()}
            for s in recent_sales
        ],
    }


# ---------------------------------------------------------------- shift
def shift(shop, user, on_date: date | None = None) -> dict:
    """One cashier's own day — the dashboard they land on after logging in.

    Everything here is either the user's own work (their sales, their items,
    their week) or operational fact they need at the counter (what's low or out
    of stock, who owes money before another credit sale). Deliberately no shop
    profit, valuation or cash position: those stay on the owner's dashboard
    (plan §8).
    """
    day = on_date or timezone.now().date()
    day_start, day_end = _datetime_range(day, day)
    prev_start, prev_end = _datetime_range(day - timedelta(days=1), day - timedelta(days=1))

    mine = _completed_sales(shop).filter(cashier=user)
    today_qs = mine.filter(occurred_at__gte=day_start, occurred_at__lt=day_end)
    agg = today_qs.aggregate(total=Sum("total"), count=Count("id"))
    sales_total = agg["total"] or 0
    sales_count = agg["count"] or 0
    items_sold = SaleItem.objects.filter(sale__in=today_qs).aggregate(q=Sum("quantity"))["q"] or 0
    yesterday_total = (
        mine.filter(occurred_at__gte=prev_start, occurred_at__lt=prev_end).aggregate(
            s=Sum("total")
        )["s"]
        or 0
    )

    # How the shop as a whole did today is not shown, but the cashier's own
    # 7-day shape is — it answers "is today normal for me?".
    week_start_day = day - timedelta(days=6)
    ws, we = _datetime_range(week_start_day, day)
    weekly = (
        mine.filter(occurred_at__gte=ws, occurred_at__lt=we)
        .annotate(bucket=TruncDate("occurred_at"))
        .values("bucket")
        .annotate(total=Sum("total"), count=Count("id"))
    )
    weekly_map = {g["bucket"]: (g["total"] or 0, g["count"]) for g in weekly}
    week_series = []
    for i in range(7):
        d = week_start_day + timedelta(days=i)
        total, count = weekly_map.get(d, (0, 0))
        week_series.append({"date": str(d), "total": total, "count": count})

    top_products = [
        {"name": r["name_snapshot"], "quantity": r["quantity"]}
        for r in SaleItem.objects.filter(sale__in=today_qs)
        .values("name_snapshot")
        .annotate(quantity=Sum("quantity"))
        .order_by("-quantity")[:5]
    ]

    recent_sales = [
        {
            "id": str(s.id),
            "occurred_at": s.occurred_at.isoformat(),
            "total": s.total,
            "item_count": s.item_count,
            "customer_name": s.customer.name if s.customer else None,
        }
        for s in today_qs.select_related("customer")
        .annotate(item_count=Count("items"))
        .order_by("-occurred_at")[:8]
    ]

    # Shelf intelligence: what to warn a customer about before promising it.
    low_stock = [
        {"name": p.name, "sku": p.sku, "stock": p.stock_cached}
        for p in Product.objects.filter(
            shop=shop, status=Product.Status.ACTIVE, stock_cached__lte=F("min_stock_alert")
        ).order_by("stock_cached", "name")[:6]
    ]

    # Customers carrying a balance — checked before extending more credit.
    debtors_qs = Customer.objects.filter(shop=shop, credit_balance_cached__gt=0)
    top_debtors = [
        {"name": c.name, "balance": c.credit_balance_cached}
        for c in debtors_qs.order_by("-credit_balance_cached")[:5]
    ]

    return {
        "currency": _currency(shop),
        "date": str(day),
        "date_ethiopian": ethiopian.format_ethiopian(day),
        "today": {
            "sales_total": sales_total,
            "sales_count": sales_count,
            "items_sold": items_sold,
            "avg_sale": round(sales_total / sales_count) if sales_count else 0,
            "yesterday_total": yesterday_total,
        },
        "week_series": week_series,
        "top_products": top_products,
        "recent_sales": recent_sales,
        "low_stock": low_stock,
        "low_stock_count": Product.objects.filter(
            shop=shop, stock_cached__lte=F("min_stock_alert")
        ).count(),
        "debtor_count": debtors_qs.count(),
        "top_debtors": top_debtors,
    }


# ---------------------------------------------------------------- helpers
def _default_range(start: date | None, end: date | None) -> tuple[date, date]:
    end = end or timezone.now().date()
    start = start or (end - timedelta(days=29))
    return start, end


def _as_date(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _ethiopian_bucket(day: date, period: str) -> tuple[str, str, str]:
    """Map a Gregorian day to an Ethiopian-calendar bucket for a report period.

    Returns ``(sort_key, series_date, row_label)`` — the series_date is a plain
    ISO date for daily/weekly (so the chart axis can render it), and an Ethiopian
    label for monthly/yearly; the row_label is always the human Ethiopian text.
    """
    year, month, _ = ethiopian.to_ethiopian(day)
    if period == "weekly":
        monday = day - timedelta(days=day.weekday())
        return (
            monday.isoformat(),
            monday.isoformat(),
            f"Week of {ethiopian.format_ethiopian(monday)}",
        )
    if period == "monthly":
        label = f"{ethiopian.MONTH_NAMES[month - 1]} {year}"
        return (f"{year:04d}-{month:02d}", label, label)
    if period == "yearly":
        return (f"{year:04d}", f"{year} E.C.", f"{year} E.C.")
    # daily
    return (day.isoformat(), day.isoformat(), ethiopian.format_ethiopian(day))


# ---------------------------------------------------------------- sales
def sales_report(shop, *, period="daily", start=None, end=None) -> dict:
    start, end = _default_range(start, end)
    range_start, range_end = _datetime_range(start, end)
    qs = _completed_sales(shop).filter(occurred_at__gte=range_start, occurred_at__lt=range_end)

    # Per-day totals, then folded into Ethiopian-calendar buckets in Python —
    # Ethiopian months (Meskerem…Pagumē, 30 days) and years don't line up with
    # Gregorian TruncMonth/Year, so grouping happens here, not in SQL.
    daily_map = {
        _as_date(g["bucket"]): (g["count"], g["total"] or 0)
        for g in qs.annotate(bucket=TruncDate("occurred_at"))
        .values("bucket")
        .annotate(count=Count("id"), total=Sum("total"))
    }
    buckets: dict[str, dict] = {}
    day = start
    while day <= end:
        count, total = daily_map.get(day, (0, 0))
        sort_key, series_date, label = _ethiopian_bucket(day, period)
        b = buckets.get(sort_key)
        if b is None:
            iso = day.isoformat()
            b = {
                "date": series_date,
                "label": label,
                "count": 0,
                "total": 0,
                "start": iso,
                "end": iso,
            }
            buckets[sort_key] = b
        b["count"] += count
        b["total"] += total
        b["end"] = day.isoformat()  # days iterate ascending → last seen is the range end
        day += timedelta(days=1)
    ordered = [buckets[k] for k in sorted(buckets)]

    rows = [[b["label"], b["count"], b["total"]] for b in ordered]
    series = [
        {
            "date": b["date"],
            "total": b["total"],
            "count": b["count"],
            "start": b["start"],
            "end": b["end"],
        }
        for b in ordered
    ]
    totals = qs.aggregate(total=Sum("total"), tax=Sum("tax"))
    summary_total = totals["total"] or 0
    # Tax charged to customers over the range. It is collected on the shop's
    # behalf and remitted, so it is part of Total sales but never of profit.
    tax_collected = totals["tax"] or 0
    summary_count = qs.count()
    items_sold = SaleItem.objects.filter(sale__in=qs).aggregate(q=Sum("quantity"))["q"] or 0
    avg_sale = round(summary_total / summary_count) if summary_count else 0
    # Per-period average — this is the KPI that changes with the grouping
    # (avg per day / week / month / year); the totals above are range-wide.
    unit = {"daily": "day", "weekly": "week", "monthly": "month", "yearly": "year"}.get(
        period, "period"
    )
    n_buckets = len(ordered)
    avg_per_period = round(summary_total / n_buckets) if n_buckets else 0
    by_method = [
        {"method": g["method"], "total": g["total"] or 0}
        for g in Payment.objects.filter(sale__in=qs)
        .values("method")
        .annotate(total=Sum("amount"))
        .order_by("-total")
    ]
    # Sales sold on credit are billed now but not yet collected, so payments
    # received fall short of total sales by exactly the outstanding balance.
    # Reporting it makes the two figures reconcile: payments + credit = sales.
    paid_on_sales = Payment.objects.filter(sale__in=qs).aggregate(s=Sum("amount"))["s"] or 0
    unpaid_credit = summary_total - paid_on_sales
    return {
        "key": "sales",
        "title": f"Sales report ({period})",
        "currency": _currency(shop),
        "period": {"start": str(start), "end": str(end), "granularity": period},
        "summary": [
            {"label": "Total sales", "value": summary_total, "money": True},
            {"label": "Transactions", "value": summary_count, "money": False},
            {"label": "Avg sale", "value": avg_sale, "money": True},
            {"label": "Items sold", "value": items_sold, "money": False},
            {"label": f"Avg / {unit}", "value": avg_per_period, "money": True},
            {"label": "Tax collected", "value": tax_collected, "money": True},
        ],
        "columns": ["Period", "Transactions", "Total"],
        "rows": rows,
        "money_columns": [2],
        "series": series,
        "by_method": by_method,
        "unpaid_credit": unpaid_credit,
    }


# ---------------------------------------------------------------- inventory
def inventory_report(shop) -> dict:
    products = Product.objects.filter(shop=shop).order_by("name")
    rows = []
    valuation = 0  # what the stock cost (Σ stock × purchase price)
    expected_sales = 0  # what it would fetch at selling price (Σ stock × selling)
    total_units = 0
    low = out = 0
    for p in products:
        line_value = p.stock_cached * p.purchase_price
        valuation += line_value
        expected_sales += p.stock_cached * p.selling_price
        total_units += max(0, p.stock_cached)
        if p.stock_cached <= 0:
            out += 1
        elif p.stock_cached <= p.min_stock_alert:
            low += 1
        rows.append([p.name, p.sku, p.stock_cached, p.purchase_price, line_value])
    # Top sellers over the last 30 days (v2 plan §4) for the inventory chart.
    since = timezone.now().date() - timedelta(days=29)
    since_dt, _ = _datetime_range(since, since)
    top_sellers = [
        {"name": g["name_snapshot"], "quantity": g["quantity"]}
        for g in SaleItem.objects.filter(
            sale__shop=shop,
            sale__status=Sale.Status.COMPLETED,
            sale__occurred_at__gte=since_dt,
        )
        .values("name_snapshot")
        .annotate(quantity=Sum("quantity"))
        .order_by("-quantity")[:8]
    ]
    # Projection: what the current stock is worth if it all sells.
    settings = getattr(shop, "settings", None)
    tax_rate = float(settings.tax_rate) if settings else 0.0
    expected_tax = int(round(expected_sales * tax_rate / 100))
    stock_value = {
        "at_cost": valuation,
        "expected_sales": expected_sales,
        "potential_profit": expected_sales - valuation,
        "tax_rate": tax_rate,
        "expected_tax": expected_tax,
        "total_if_sold": expected_sales + expected_tax,
    }
    return {
        "key": "inventory",
        "title": "Inventory report",
        "currency": _currency(shop),
        "summary": [
            {"label": "Stock valuation", "value": valuation, "money": True},
            {"label": "Low stock", "value": low, "money": False},
            {"label": "Out of stock", "value": out, "money": False},
            {"label": "Units in stock", "value": total_units, "money": False},
        ],
        "columns": ["Product", "SKU", "Stock", "Unit cost", "Valuation"],
        "rows": rows,
        "money_columns": [3, 4],
        "top_sellers": top_sellers,
        "stock_value": stock_value,
    }


# ---------------------------------------------------------------- profit
def profit_report(shop, *, start=None, end=None) -> dict:
    start, end = _default_range(start, end)
    range_start, range_end = _datetime_range(start, end)
    qs = _completed_sales(shop).filter(occurred_at__gte=range_start, occurred_at__lt=range_end)
    agg = qs.aggregate(subtotal=Sum("subtotal"), discount=Sum("discount"), tax=Sum("tax"))
    # Revenue is the shop's own income — tax collected is remitted to the state,
    # so it is excluded from revenue, gross profit, and margin.
    revenue = (agg["subtotal"] or 0) - (agg["discount"] or 0)
    tax = agg["tax"] or 0
    cogs = _cogs(qs)
    gross = revenue - cogs
    expenses = (
        Expense.objects.filter(shop=shop, date__gte=start, date__lte=end).aggregate(
            s=Sum("amount")
        )["s"]
        or 0
    )
    net = gross - expenses

    # Daily series + expense breakdown (v2 plan §4), zero-filled so charts
    # show quiet days. Capped at ~a year of points.
    daily_revenue = {
        g["bucket"]: g["s"] or 0
        for g in qs.annotate(bucket=TruncDate("occurred_at"))
        .values("bucket")
        .annotate(s=Sum("subtotal") - Sum("discount"))
    }
    daily_cogs = {
        g["bucket"]: g["s"] or 0
        for g in SaleItem.objects.filter(sale__in=qs)
        .annotate(bucket=TruncDate("sale__occurred_at"))
        .values("bucket")
        .annotate(s=Sum(_LINE_COST))
    }
    daily_expenses = {
        g["date"]: g["s"] or 0
        for g in Expense.objects.filter(shop=shop, date__gte=start, date__lte=end)
        .values("date")
        .annotate(s=Sum("amount"))
    }
    series = []
    day = start
    while day <= end and len(series) <= 366:
        rev = daily_revenue.get(day, 0)
        day_cogs = daily_cogs.get(day, 0)
        exp = daily_expenses.get(day, 0)
        series.append(
            {
                "date": str(day),
                "revenue": rev,
                "cogs": day_cogs,
                "expenses": exp,
                "net": rev - day_cogs - exp,
            }
        )
        day += timedelta(days=1)

    by_category = [
        {"category": g["category__name"] or "Uncategorized", "total": g["s"] or 0}
        for g in Expense.objects.filter(shop=shop, date__gte=start, date__lte=end)
        .values("category__name")
        .annotate(s=Sum("amount"))
        .order_by("-s")
    ]

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
            {"label": "Tax collected", "value": tax, "money": True},
        ],
        "columns": ["Metric", "Amount"],
        "rows": [
            ["Revenue (net of tax)", revenue],
            ["Cost of goods sold", cogs],
            ["Gross profit", gross],
            ["Expenses", expenses],
            ["Net profit", net],
            ["Tax collected (remitted, not income)", tax],
        ],
        "money_columns": [1],
        "series": series,
        "by_category": by_category,
    }


# ---------------------------------------------------------------- cashflow
def cashflow_report(shop, *, start=None, end=None) -> dict:
    start, end = _default_range(start, end)
    range_start, range_end = _datetime_range(start, end)
    # Money in = ALL payments received (cash + Telebirr/CBE/mobile/bank). Digital
    # wallets and bank transfers are cash equivalents, so a cash-flow statement
    # counts them too — not just physical cash.
    cash_in = (
        Payment.objects.filter(
            shop=shop,
            received_at__gte=range_start,
            received_at__lt=range_end,
        )
        .exclude(sale__status=Sale.Status.VOIDED)
        .aggregate(s=Sum("amount"))["s"]
        or 0
    )
    # Expenses charged per day, with monthly costs prorated across the month
    # (matching My Day and the dashboard) so a monthly expense doesn't spike the
    # cash flow on the single day it was recorded. Over a full month the prorated
    # daily shares still sum to the actual amount.
    daily_expenses = {}
    _d = start
    while _d <= end and len(daily_expenses) <= 366:
        daily_expenses[_d] = _expense_charge(shop, _d)["charge_total"]
        _d += timedelta(days=1)
    expenses = sum(daily_expenses.values())
    purchases_paid = (
        Purchase.objects.filter(shop=shop, date__gte=start, date__lte=end).aggregate(
            s=Sum("amount_paid")
        )["s"]
        or 0
    )
    net = cash_in - expenses - purchases_paid

    # Daily in/out series with a running balance within the range (v2 plan §4).
    daily_in = {
        g["bucket"]: g["s"] or 0
        for g in Payment.objects.filter(
            shop=shop,
            received_at__gte=range_start,
            received_at__lt=range_end,
        )
        .exclude(sale__status=Sale.Status.VOIDED)
        .annotate(bucket=TruncDate("received_at"))
        .values("bucket")
        .annotate(s=Sum("amount"))
    }
    daily_purchases = {
        g["date"]: g["s"] or 0
        for g in Purchase.objects.filter(shop=shop, date__gte=start, date__lte=end)
        .values("date")
        .annotate(s=Sum("amount_paid"))
    }
    series = []
    balance = 0
    day = start
    while day <= end and len(series) <= 366:
        cash_in_day = daily_in.get(day, 0)
        cash_out_day = daily_expenses.get(day, 0) + daily_purchases.get(day, 0)
        balance += cash_in_day - cash_out_day
        series.append(
            {
                "date": str(day),
                "cash_in": cash_in_day,
                "cash_out": cash_out_day,
                "net": cash_in_day - cash_out_day,
                "balance": balance,
            }
        )
        day += timedelta(days=1)

    return {
        "key": "cashflow",
        "title": "Cash flow report",
        "currency": _currency(shop),
        "period": {"start": str(start), "end": str(end)},
        "summary": [{"label": "Net cash flow", "value": net, "money": True}],
        "columns": ["Metric", "Amount"],
        "rows": [
            ["Money received (all methods)", cash_in],
            ["Expenses paid", expenses],
            ["Purchases paid", purchases_paid],
            ["Net cash flow", net],
        ],
        "money_columns": [1],
        "series": series,
    }
