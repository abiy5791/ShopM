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


def test_cashflow_series_runs_a_balance(shop_with_sale):
    shop, client = shop_with_sale
    data = client.get("/api/v1/reports/cashflow").data
    assert data["series"][-1]["balance"] == data["summary"][0]["value"]


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
