"""Per-page KPI summaries — the card row that sits above each list table.

Every list screen (Products, Sales, Customers, Purchases, Suppliers, Expenses,
Activity) gets four headline figures so the page answers "how are we doing?"
before the user reads a single row. The figures are shop-wide, not page-wide:
they never change as the user pages or filters the table under them.

All money is integer minor units, and all the aggregations reuse the same
helpers the reports do, so a KPI card and a report can never disagree. Months
are Ethiopian months (Meskerem…Pagumē), matching the rest of the app.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.db.models import BigIntegerField, Count, ExpressionWrapper, F, Q, Sum
from django.utils import timezone

from apps.activity.models import ActivityLog
from apps.catalog.models import Product, Supplier
from apps.common import ethiopian
from apps.common.money import format_money
from apps.customers.models import Customer
from apps.expenses.models import Expense
from apps.purchases.models import Purchase
from apps.sales.models import Payment, SaleItem

# Shared with the reports so a card and a report row can't drift apart.
from .services import _completed_sales, _currency, _datetime_range

_STOCK_AT_COST = ExpressionWrapper(
    F("stock_cached") * F("purchase_price"), output_field=BigIntegerField()
)
_STOCK_AT_RETAIL = ExpressionWrapper(
    F("stock_cached") * F("selling_price"), output_field=BigIntegerField()
)
_STILL_DUE = ExpressionWrapper(F("total") - F("amount_paid"), output_field=BigIntegerField())


def _card(
    key: str,
    label: str,
    value: int,
    *,
    money: bool = False,
    hint: str = "",
    tone: str = "default",
    delta: dict | None = None,
) -> dict:
    """One KPI tile. ``tone`` colours the number (default/positive/negative/
    warning); ``delta`` renders a period-over-period chip next to the hint."""
    return {
        "key": key,
        "label": label,
        "value": value,
        "money": money,
        "hint": hint,
        "tone": tone,
        "delta": delta,
    }


def _delta(current: int, previous: int, label: str) -> dict:
    return {"current": current, "previous": previous, "label": label}


def _month_name(day: date) -> str:
    _, month, _ = ethiopian.to_ethiopian(day)
    return ethiopian.MONTH_NAMES[month - 1]


def _this_month(day: date) -> tuple[date, date]:
    """Gregorian [first, last] of the Ethiopian month containing ``day``."""
    return ethiopian.month_bounds_gregorian(day)


def _previous_month(day: date) -> tuple[date, date]:
    first, _ = _this_month(day)
    return _this_month(first - timedelta(days=1))


def _plural(count: int, singular: str, plural: str | None = None) -> str:
    return f"{count} {singular if count == 1 else (plural or singular + 's')}"


def _summary(shop, cards: list[dict]) -> dict:
    return {"currency": _currency(shop), "cards": cards}


# ---------------------------------------------------------------- products
def products_summary(shop, *, financial: bool = True) -> dict:
    """Catalogue KPIs. ``financial=False`` (cashiers) swaps the valuation tiles
    for stock counts — the same page, minus the figures they may not see."""
    currency = _currency(shop)
    agg = Product.objects.filter(shop=shop).aggregate(
        total=Count("id"),
        active=Count("id", filter=Q(status=Product.Status.ACTIVE)),
        low=Count("id", filter=Q(stock_cached__lte=F("min_stock_alert"))),
        out=Count("id", filter=Q(stock_cached__lte=0)),
        units=Sum("stock_cached"),
        at_cost=Sum(_STOCK_AT_COST),
        at_retail=Sum(_STOCK_AT_RETAIL),
    )
    total = agg["total"] or 0
    active = agg["active"] or 0
    low = agg["low"] or 0
    out = agg["out"] or 0
    units = agg["units"] or 0
    at_cost = agg["at_cost"] or 0
    at_retail = agg["at_retail"] or 0

    shared = [
        _card(
            "products",
            "Products",
            total,
            hint=f"{active} active · {total - active} inactive",
        ),
        _card(
            "low_stock",
            "Low stock",
            low,
            hint=f"{out} out of stock",
            tone="warning" if low else "default",
        ),
    ]
    if not financial:
        # What a cashier needs off the shelf: how much is there, and what has
        # run out — the two questions a customer at the counter actually asks.
        return _summary(
            shop,
            [
                *shared,
                _card("out_of_stock", "Out of stock", out, hint="unavailable to sell"),
                _card("units", "Units in stock", max(units, 0), hint="across the catalogue"),
            ],
        )
    return _summary(
        shop,
        [
            *shared,
            _card(
                "stock_value",
                "Stock value",
                at_cost,
                money=True,
                hint=f"{units:,} units at cost",
            ),
            _card(
                "retail_value",
                "Retail value",
                at_retail,
                money=True,
                hint=f"{format_money(at_retail - at_cost, currency)} potential margin",
            ),
        ],
    )


# ---------------------------------------------------------------- sales
def sales_summary(shop, on_date: date | None = None, cashier=None) -> dict:
    """Takings KPIs. Pass ``cashier`` to scope every figure to one person's own
    sales — what a cashier needs to reconcile their till, and nothing wider."""
    if cashier is not None:
        return _own_sales_summary(shop, cashier, on_date)

    today = on_date or timezone.now().date()
    yesterday = today - timedelta(days=1)
    month_first, _ = _this_month(today)

    day_start, day_end = _datetime_range(today, today)
    prev_start, prev_end = _datetime_range(yesterday, yesterday)
    month_start, month_end = _datetime_range(month_first, today)

    completed = _completed_sales(shop)
    today_qs = completed.filter(created_at__gte=day_start, created_at__lt=day_end)
    today_agg = today_qs.aggregate(total=Sum("total"), count=Count("id"))
    today_total = today_agg["total"] or 0
    today_count = today_agg["count"] or 0
    yesterday_total = (
        completed.filter(created_at__gte=prev_start, created_at__lt=prev_end).aggregate(
            s=Sum("total")
        )["s"]
        or 0
    )

    month_qs = completed.filter(created_at__gte=month_start, created_at__lt=month_end)
    month_agg = month_qs.aggregate(total=Sum("total"), count=Count("id"))
    month_total = month_agg["total"] or 0
    month_count = month_agg["count"] or 0
    items_sold = SaleItem.objects.filter(sale__in=month_qs).aggregate(q=Sum("quantity"))["q"] or 0
    avg_sale = round(month_total / month_count) if month_count else 0

    # Sold on credit: billed this month but not yet collected. Payments received
    # against those sales fall short of their total by exactly that amount.
    paid = Payment.objects.filter(sale__in=month_qs).aggregate(s=Sum("amount"))["s"] or 0
    on_credit = month_total - paid

    return _summary(
        shop,
        [
            _card(
                "today",
                "Sales today",
                today_total,
                money=True,
                hint=_plural(today_count, "sale"),
                delta=_delta(today_total, yesterday_total, "vs yesterday"),
            ),
            _card(
                "month",
                f"{_month_name(today)} sales",
                month_total,
                money=True,
                hint=_plural(month_count, "sale"),
            ),
            _card(
                "avg_sale",
                "Average sale",
                avg_sale,
                money=True,
                hint=f"{items_sold:,} items sold this month",
            ),
            _card(
                "on_credit",
                "Sold on credit",
                on_credit,
                money=True,
                hint="awaiting payment this month",
                tone="warning" if on_credit > 0 else "default",
            ),
        ],
    )


def _own_sales_summary(shop, cashier, on_date: date | None = None) -> dict:
    """One cashier's own till: today, yesterday for context, and the week."""
    today = on_date or timezone.now().date()
    day_start, day_end = _datetime_range(today, today)
    prev_start, prev_end = _datetime_range(today - timedelta(days=1), today - timedelta(days=1))
    week_start, _ = _datetime_range(today - timedelta(days=6), today)

    mine = _completed_sales(shop).filter(cashier=cashier)
    today_qs = mine.filter(created_at__gte=day_start, created_at__lt=day_end)
    agg = today_qs.aggregate(total=Sum("total"), count=Count("id"))
    total = agg["total"] or 0
    count = agg["count"] or 0
    yesterday_total = (
        mine.filter(created_at__gte=prev_start, created_at__lt=prev_end).aggregate(s=Sum("total"))[
            "s"
        ]
        or 0
    )
    items = SaleItem.objects.filter(sale__in=today_qs).aggregate(q=Sum("quantity"))["q"] or 0

    week_qs = mine.filter(created_at__gte=week_start, created_at__lt=day_end)
    week_agg = week_qs.aggregate(total=Sum("total"), count=Count("id"))

    return _summary(
        shop,
        [
            _card(
                "today",
                "My sales today",
                total,
                money=True,
                hint=_plural(count, "sale"),
                delta=_delta(total, yesterday_total, "vs yesterday"),
            ),
            _card(
                "items_today",
                "Items sold today",
                items,
                hint=f"across {_plural(count, 'sale')}",
            ),
            _card(
                "avg_sale",
                "My average sale",
                round(total / count) if count else 0,
                money=True,
                hint="today",
            ),
            _card(
                "week_takings",
                "My last 7 days",
                week_agg["total"] or 0,
                money=True,
                hint=_plural(week_agg["count"] or 0, "sale"),
            ),
        ],
    )


# ---------------------------------------------------------------- customers
def customers_summary(shop, on_date: date | None = None) -> dict:
    today = on_date or timezone.now().date()
    month_first, _ = _this_month(today)
    month_start, month_end = _datetime_range(month_first, today)

    customers = Customer.objects.filter(shop=shop)
    agg = customers.aggregate(
        total=Count("id"),
        owing=Count("id", filter=Q(credit_balance_cached__gt=0)),
        credit=Sum("credit_balance_cached", filter=Q(credit_balance_cached__gt=0)),
        joined=Count("id", filter=Q(created_at__gte=month_start)),
    )
    total = agg["total"] or 0
    owing = agg["owing"] or 0
    credit = agg["credit"] or 0

    top = customers.order_by("-credit_balance_cached").first()
    top_balance = top.credit_balance_cached if top else 0

    # Standalone payments (no sale attached) are debts being settled.
    settled = (
        Payment.objects.filter(
            shop=shop,
            sale__isnull=True,
            received_at__gte=month_start,
            received_at__lt=month_end,
        ).aggregate(s=Sum("amount"))["s"]
        or 0
    )

    return _summary(
        shop,
        [
            _card(
                "customers",
                "Customers",
                total,
                hint=f"{agg['joined'] or 0} added in {_month_name(today)}",
            ),
            _card(
                "credit",
                "Outstanding credit",
                credit,
                money=True,
                hint=f"{_plural(owing, 'customer')} with a balance",
                tone="warning" if credit > 0 else "default",
            ),
            _card(
                "largest_balance",
                "Largest balance",
                max(top_balance, 0),
                money=True,
                hint=top.name if top and top_balance > 0 else "Nobody owes you",
            ),
            _card(
                "settled",
                "Credit settled",
                settled,
                money=True,
                hint=f"received in {_month_name(today)}",
                tone="positive" if settled > 0 else "default",
            ),
        ],
    )


# ---------------------------------------------------------------- purchases
def purchases_summary(shop, on_date: date | None = None) -> dict:
    currency = _currency(shop)
    today = on_date or timezone.now().date()
    month_first, month_last = _this_month(today)
    prev_first, prev_last = _previous_month(today)

    purchases = Purchase.objects.filter(shop=shop)
    month = purchases.filter(date__gte=month_first, date__lte=month_last)
    month_agg = month.aggregate(total=Sum("total"), count=Count("id"), paid=Sum("amount_paid"))
    month_total = month_agg["total"] or 0
    month_paid = month_agg["paid"] or 0
    prev_total = (
        purchases.filter(date__gte=prev_first, date__lte=prev_last).aggregate(s=Sum("total"))["s"]
        or 0
    )

    outstanding = purchases.aggregate(s=Sum(_STILL_DUE))["s"] or 0
    open_count = purchases.exclude(payment_status=Purchase.PaymentStatus.PAID).count()

    top = (
        month.exclude(supplier__isnull=True)
        .values("supplier__name")
        .annotate(spend=Sum("total"))
        .order_by("-spend")
        .first()
    )

    return _summary(
        shop,
        [
            _card(
                "month_spend",
                f"{_month_name(today)} purchases",
                month_total,
                money=True,
                hint=_plural(month_agg["count"] or 0, "purchase"),
                delta=_delta(month_total, prev_total, f"vs {_month_name(prev_first)}"),
            ),
            _card(
                "paid",
                "Paid this month",
                month_paid,
                money=True,
                hint=f"{format_money(month_total - month_paid, currency)} still due",
            ),
            _card(
                "outstanding",
                "Outstanding payable",
                outstanding,
                money=True,
                hint=f"{open_count} unpaid or partial",
                tone="warning" if outstanding > 0 else "default",
            ),
            _card(
                "top_supplier",
                "Top supplier",
                top["spend"] if top else 0,
                money=True,
                hint=top["supplier__name"] if top else "No supplier purchases yet",
            ),
        ],
    )


# ---------------------------------------------------------------- suppliers
def suppliers_summary(shop, on_date: date | None = None) -> dict:
    today = on_date or timezone.now().date()
    month_first, month_last = _this_month(today)

    suppliers = Supplier.objects.filter(shop=shop)
    agg = suppliers.aggregate(
        total=Count("id"),
        owed=Count("id", filter=Q(payable_cached__gt=0)),
        payable=Sum("payable_cached", filter=Q(payable_cached__gt=0)),
    )
    payable = agg["payable"] or 0

    month = Purchase.objects.filter(shop=shop, date__gte=month_first, date__lte=month_last)
    month_agg = month.aggregate(total=Sum("total"), count=Count("id"))

    biggest = (
        Purchase.objects.filter(shop=shop)
        .exclude(supplier__isnull=True)
        .values("supplier__name")
        .annotate(spend=Sum("total"))
        .order_by("-spend")
        .first()
    )

    return _summary(
        shop,
        [
            _card(
                "suppliers",
                "Suppliers",
                agg["total"] or 0,
                hint=f"{agg['owed'] or 0} with an open balance",
            ),
            _card(
                "payable",
                "Total payable",
                payable,
                money=True,
                hint="owed to suppliers",
                tone="warning" if payable > 0 else "default",
            ),
            _card(
                "month_spend",
                f"{_month_name(today)} spend",
                month_agg["total"] or 0,
                money=True,
                hint=_plural(month_agg["count"] or 0, "purchase"),
            ),
            _card(
                "biggest_supplier",
                "Biggest supplier",
                biggest["spend"] if biggest else 0,
                money=True,
                hint=biggest["supplier__name"] if biggest else "No purchases yet",
            ),
        ],
    )


# ---------------------------------------------------------------- expenses
def expenses_summary(shop, on_date: date | None = None) -> dict:
    currency = _currency(shop)
    today = on_date or timezone.now().date()
    month_first, month_last = _this_month(today)
    prev_first, prev_last = _previous_month(today)

    expenses = Expense.objects.filter(shop=shop)
    month = expenses.filter(date__gte=month_first, date__lte=month_last)
    month_agg = month.aggregate(
        total=Sum("amount"),
        count=Count("id"),
        recurring=Sum("amount", filter=Q(recurrence=Expense.Recurrence.MONTHLY)),
        recurring_count=Count("id", filter=Q(recurrence=Expense.Recurrence.MONTHLY)),
    )
    month_total = month_agg["total"] or 0
    recurring = month_agg["recurring"] or 0
    prev_total = (
        expenses.filter(date__gte=prev_first, date__lte=prev_last).aggregate(s=Sum("amount"))["s"]
        or 0
    )

    # Spend so far, per day elapsed — the number that tells an owner whether this
    # month is running hot before the month is over.
    _, _, day_of_month = ethiopian.to_ethiopian(today)
    per_day = round(month_total / day_of_month) if day_of_month else 0

    top = month.values("category__name").annotate(spend=Sum("amount")).order_by("-spend").first()

    return _summary(
        shop,
        [
            _card(
                "month",
                f"{_month_name(today)} expenses",
                month_total,
                money=True,
                hint=_plural(month_agg["count"] or 0, "expense"),
                delta=_delta(month_total, prev_total, f"vs {_month_name(prev_first)}"),
            ),
            _card(
                "per_day",
                "Average per day",
                per_day,
                money=True,
                hint=f"over {_plural(day_of_month, 'day')} so far",
            ),
            _card(
                "top_category",
                "Top category",
                top["spend"] if top else 0,
                money=True,
                hint=(top["category__name"] or "Uncategorized") if top else "Nothing spent yet",
            ),
            _card(
                "recurring",
                "Monthly recurring",
                recurring,
                money=True,
                hint=(
                    f"{month_agg['recurring_count'] or 0} fixed costs · "
                    f"{format_money(round(recurring / 30), currency)}/day"
                ),
            ),
        ],
    )


# ---------------------------------------------------------------- activity
def activity_summary(shop, queryset=None, on_date: date | None = None) -> dict:
    """KPIs for the audit trail. ``queryset`` is the caller's already role-scoped
    log (cashiers only ever see their own rows), so the cards match the table."""
    today = on_date or timezone.now().date()
    logs = ActivityLog.objects.filter(shop=shop) if queryset is None else queryset

    day_start, day_end = _datetime_range(today, today)
    week_start, _ = _datetime_range(today - timedelta(days=6), today)
    month_start, _ = _datetime_range(today - timedelta(days=29), today)

    today_count = logs.filter(created_at__gte=day_start, created_at__lt=day_end).count()
    week = logs.filter(created_at__gte=week_start, created_at__lt=day_end)
    week_count = week.count()

    recent = logs.filter(created_at__gte=month_start, created_at__lt=day_end)
    alerts = recent.aggregate(
        warn=Count("id", filter=Q(level=ActivityLog.Level.WARN)),
        critical=Count("id", filter=Q(level=ActivityLog.Level.CRITICAL)),
    )
    flagged = (alerts["warn"] or 0) + (alerts["critical"] or 0)

    people = week.exclude(user__isnull=True).values("user_id").distinct().count()
    busiest = week.values("action").annotate(n=Count("id")).order_by("-n").first()

    return _summary(
        shop,
        [
            # Keys are the frontend's icon lookup, so they stay unique across
            # resources — "today" already belongs to the sales row.
            _card(
                "events_today",
                "Events today",
                today_count,
                hint=f"{week_count} in the last 7 days",
            ),
            _card(
                "events_week",
                "Last 7 days",
                week_count,
                hint=f"~{round(week_count / 7)} per day",
            ),
            _card(
                "flagged",
                "Flagged (30 days)",
                flagged,
                hint=f"{alerts['critical'] or 0} critical",
                tone="warning" if flagged else "default",
            ),
            _card(
                "active_staff",
                "Active staff",
                people,
                hint=(
                    f"busiest: {busiest['action']}" if busiest else "No activity in the last 7 days"
                ),
            ),
        ],
    )
