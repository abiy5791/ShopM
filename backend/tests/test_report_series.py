"""Phase C (v2 plan §4): chart-ready series on reports & dashboard."""

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.catalog.models import Product
from apps.expenses.models import Expense, ExpenseCategory
from apps.inventory.services import record_transaction

pytestmark = pytest.mark.django_db


@pytest.fixture
def shop_with_sale(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = Product.objects.create(shop=shop, sku="SKU-1", name="Widget", selling_price=1000)
    record_transaction(product=product, quantity=10, type="adjustment")
    client = auth(owner, shop=shop)
    resp = client.post(
        "/api/v1/sales",
        {
            "client_uuid": str(uuid.uuid4()),
            "items": [{"product": str(product.id), "quantity": 2}],
            "payments": [{"method": "cash", "amount": 2000}],
        },
        format="json",
    )
    assert resp.status_code == 201
    return shop, client


def test_sales_report_exposes_series_and_method_breakdown(shop_with_sale):
    shop, client = shop_with_sale
    data = client.get("/api/v1/reports/sales").data
    assert data["series"], "expected at least one series point"
    today_point = data["series"][-1]
    assert today_point["total"] == 2000 and today_point["count"] == 1
    assert data["by_method"] == [{"method": "cash", "total": 2000}]


def test_profit_report_series_zero_fills_and_ties_out(shop_with_sale):
    shop, client = shop_with_sale
    category = ExpenseCategory.objects.create(shop=shop, name="Rent")
    Expense.objects.create(
        shop=shop,
        category=category,
        amount=500,
        date=timezone.now().date(),
        description="rent",
        user=shop.owner,
    )

    start = (timezone.now().date() - timedelta(days=2)).isoformat()
    data = client.get(f"/api/v1/reports/profit?start={start}").data
    assert len(data["series"]) == 3  # zero-filled: two quiet days + today
    assert data["series"][0]["revenue"] == 0
    today_point = data["series"][-1]
    assert today_point["revenue"] == 2000
    assert today_point["expenses"] == 500
    assert data["by_category"] == [{"category": "Rent", "total": 500}]
    # The series nets sum to the headline net profit.
    assert sum(p["net"] for p in data["series"]) == data["summary"][0]["value"]


def test_profit_report_excludes_tax_from_revenue_and_profit(make_user, make_shop, auth):
    """Profit report revenue/gross/net must be net of tax; tax is a separate line."""
    import uuid

    from apps.inventory.services import record_transaction

    owner = make_user("owner-ptax@shopm.local")
    shop = make_shop(owner, name="P")
    product = Product.objects.create(
        shop=shop, sku="SKU-P", name="Tee", selling_price=25000, purchase_price=20000
    )
    record_transaction(product=product, quantity=10, type="adjustment")
    client = auth(owner, shop=shop)
    resp = client.post(
        "/api/v1/sales",
        {
            "client_uuid": str(uuid.uuid4()),
            "items": [{"product": str(product.id), "quantity": 1}],
            "tax": 3750,
            "payments": [{"method": "cash", "amount": 28750}],
        },
        format="json",
    )
    assert resp.status_code == 201, resp.content

    data = client.get("/api/v1/reports/profit").data
    rows = {r[0]: r[1] for r in data["rows"]}
    assert rows["Revenue (net of tax)"] == 25000  # not the 28750 collected
    assert rows["Gross profit"] == 5000  # 25000 − 20000, tax excluded
    assert rows["Net profit"] == 5000
    assert rows["Tax collected (remitted, not income)"] == 3750
    # Today's series revenue is net of tax too.
    assert data["series"][-1]["revenue"] == 25000
    # Gross margin % is on net revenue: 5000 / 25000 = 20%.
    margin = next(s for s in data["summary"] if s["label"] == "Gross margin %")
    assert margin["value"] == 20


def test_cashflow_series_runs_a_balance(shop_with_sale):
    shop, client = shop_with_sale
    data = client.get("/api/v1/reports/cashflow").data
    assert data["series"][-1]["balance"] == data["summary"][0]["value"]


def test_cashflow_counts_all_payment_methods(make_user, make_shop, auth):
    """Cash flow must count digital payments (Telebirr/CBE/mobile), not just cash."""
    import uuid

    from apps.inventory.services import record_transaction

    owner = make_user("owner-cf@shopm.local")
    shop = make_shop(owner, name="CF")
    product = Product.objects.create(shop=shop, sku="CF-1", name="Item", selling_price=1000)
    record_transaction(product=product, quantity=5, type="adjustment")
    client = auth(owner, shop=shop)
    client.post(
        "/api/v1/sales",
        {
            "client_uuid": str(uuid.uuid4()),
            "items": [{"product": str(product.id), "quantity": 1}],
            "payments": [{"method": "telebirr", "amount": 1000}],
        },
        format="json",
    )
    data = client.get("/api/v1/reports/cashflow").data
    rows = {r[0]: r[1] for r in data["rows"]}
    assert rows["Money received (all methods)"] == 1000  # telebirr counted as money in


def test_cashflow_prorates_monthly_expenses(make_user, make_shop, auth):
    """A monthly expense is spread over the month in cash flow too (like My Day),
    so it doesn't spike the single day it was recorded."""
    from apps.expenses.models import Expense, ExpenseCategory

    owner = make_user("owner-cfp@shopm.local")
    shop = make_shop(owner, name="CFP")
    client = auth(owner, shop=shop)
    cat = ExpenseCategory.objects.create(shop=shop, name="Rent")
    today = timezone.now().date()
    Expense.objects.create(
        shop=shop,
        category=cat,
        amount=3000,
        date=today,
        recurrence=Expense.Recurrence.MONTHLY,
        user=owner,
    )
    data = client.get(f"/api/v1/reports/cashflow?start={today}&end={today}").data
    rows = {r[0]: r[1] for r in data["rows"]}
    assert 0 < rows["Expenses paid"] < 3000  # prorated day-share, not the full 3000


def test_sales_report_buckets_use_ethiopian_calendar():
    """Sales aggregation labels follow the Ethiopian calendar (2026-07-27 = Hamle 20, 2018)."""
    from datetime import date

    from apps.reports.services import _ethiopian_bucket

    d = date(2026, 7, 27)
    assert _ethiopian_bucket(d, "daily")[2] == "Hamle 20, 2018"
    assert _ethiopian_bucket(d, "monthly") == ("2018-11", "Hamle 2018", "Hamle 2018")
    assert _ethiopian_bucket(d, "yearly")[2] == "2018 E.C."
    # A day in the previous Ethiopian month groups separately.
    assert _ethiopian_bucket(date(2026, 6, 20), "monthly")[1] == "Sene 2018"


def test_sales_report_monthly_labels_are_ethiopian(shop_with_sale):
    from apps.common.ethiopian import MONTH_NAMES

    shop, client = shop_with_sale
    data = client.get("/api/v1/reports/sales?period=monthly").data
    assert data["columns"][0] == "Period"
    # The single sale's month is an Ethiopian month name + year, not "2026-07".
    assert data["rows"], "expected a monthly row"
    label = data["rows"][-1][0]
    assert any(label.startswith(name) for name in MONTH_NAMES)


def test_inventory_report_lists_top_sellers(shop_with_sale):
    shop, client = shop_with_sale
    data = client.get("/api/v1/reports/inventory").data
    assert data["top_sellers"][0] == {"name": "Widget", "quantity": 2}


def test_dashboard_accepts_date_and_returns_week_series(shop_with_sale):
    shop, client = shop_with_sale
    data = client.get("/api/v1/dashboard").data
    assert len(data["week_series"]) == 7
    assert data["week_series"][-1]["total"] == 2000  # today's sale

    # A date with no sales reports zeroes (yesterday).
    yesterday = (timezone.now().date() - timedelta(days=1)).isoformat()
    data = client.get(f"/api/v1/dashboard?date={yesterday}").data
    assert data["date"] == yesterday
    assert data["today"]["sales_total"] == 0
