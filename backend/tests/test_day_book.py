"""The "My Day" day-book endpoint (GET /reports/day)."""

import uuid

import pytest
from django.utils import timezone

from apps.catalog.models import Product
from apps.expenses.models import Expense, ExpenseCategory
from apps.inventory.services import record_transaction

pytestmark = pytest.mark.django_db


@pytest.fixture
def shop_with_day(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = Product.objects.create(
        shop=shop, sku="SKU-1", name="Widget", selling_price=1000, purchase_price=600
    )
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


def test_day_book_totals_and_sections(shop_with_day):
    shop, client = shop_with_day
    category = ExpenseCategory.objects.create(shop=shop, name="Rent")
    Expense.objects.create(
        shop=shop,
        category=category,
        amount=500,
        date=timezone.now().date(),
        description="daily rent",
        user=shop.owner,
    )

    data = client.get("/api/v1/reports/day").data

    # Headline numbers tie out: gross = revenue - COGS (2 * 600), net subtracts expenses.
    assert data["summary"]["sales_total"] == 2000
    assert data["summary"]["sales_count"] == 1
    assert data["summary"]["items_sold"] == 2
    assert data["summary"]["gross_profit"] == 2000 - 1200
    assert data["summary"]["expenses_total"] == 500
    assert data["summary"]["net_profit"] == 2000 - 1200 - 500
    assert data["summary"]["cash_received"] == 2000

    assert data["by_method"] == [{"method": "cash", "total": 2000}]
    assert data["summary"]["discount_total"] == 0
    assert data["top_products"] == [{"name": "Widget", "quantity": 2, "revenue": 2000}]
    assert len(data["sales"]) == 1
    assert data["sales"][0]["item_count"] == 1  # one line, quantity 2
    assert data["sales"][0]["total"] == 2000
    assert data["expenses"] == [{"category": "Rent", "description": "daily rent", "amount": 500}]
    # The sale created above emits a sale.create activity row for the day.
    assert any(a["action"] == "sale.create" for a in data["activity"])


def test_day_book_scopes_cash_to_sales_not_settlements(shop_with_day):
    """A credit settlement is money in, but not from today's sales — it must not
    inflate cash_received or the payment-method breakdown."""
    from apps.customers.models import Customer
    from apps.sales.models import Payment

    shop, client = shop_with_day  # one cash sale of 2000 already made today
    cust = Customer.objects.create(shop=shop, name="Debtor")
    Payment.objects.create(
        shop=shop, sale=None, customer=cust, method="cash", amount=1200, user=shop.owner
    )

    s = client.get("/api/v1/reports/day").data
    assert s["summary"]["cash_received"] == 2000  # sales cash only, not the 1200 settlement
    assert s["summary"]["settlements_received"] == 1200  # reported separately
    assert s["by_method"] == [{"method": "cash", "total": 2000}]  # reconciles with sales


def test_day_book_excludes_tax_from_profit(make_user, make_shop, auth):
    """Tax is collected for the state, not earned — it must not inflate profit."""
    owner = make_user("owner-tax@shopm.local")
    shop = make_shop(owner, name="T")
    product = Product.objects.create(
        shop=shop, sku="SKU-T", name="Tee", selling_price=25000, purchase_price=20000
    )
    record_transaction(product=product, quantity=10, type="adjustment")
    client = auth(owner, shop=shop)
    # Sell 1 @ Br250.00 with Br37.50 tax → customer pays Br287.50 (minor units).
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

    summary = client.get("/api/v1/reports/day").data["summary"]
    assert summary["sales_total"] == 28750  # collected, tax included
    assert summary["net_sales"] == 25000  # the shop's own revenue (ex-tax)
    assert summary["tax_total"] == 3750
    # Profit is on the Br250 sale, not the Br287.50 the customer paid.
    assert summary["gross_profit"] == 25000 - 20000  # == 5000, not 8750
    assert summary["net_profit"] == 5000


def test_day_book_prorates_monthly_expense(make_user, make_shop, auth):
    """A monthly salary is spread across the ETHIOPIAN month, not one day."""
    from apps.common import ethiopian

    owner = make_user("owner-prorate@shopm.local")
    shop = make_shop(owner, name="M")
    product = Product.objects.create(
        shop=shop, sku="SKU-M", name="Tee", selling_price=25000, purchase_price=20000
    )
    record_transaction(product=product, quantity=10, type="adjustment")
    client = auth(owner, shop=shop)
    client.post(
        "/api/v1/sales",
        {
            "client_uuid": str(uuid.uuid4()),
            "items": [{"product": str(product.id), "quantity": 1}],
            "payments": [{"method": "cash", "amount": 25000}],
        },
        format="json",
    )
    today = timezone.now().date()
    cat = ExpenseCategory.objects.create(shop=shop, name="Salary")
    # Br5,000.00 monthly salary + a Br30.00 one-time cost, both dated today.
    Expense.objects.create(
        shop=shop,
        category=cat,
        amount=500000,
        date=today,
        recurrence=Expense.Recurrence.MONTHLY,
        description="cashier salary",
        user=owner,
    )
    Expense.objects.create(
        shop=shop,
        amount=3000,
        date=today,
        recurrence=Expense.Recurrence.ONE_TIME,
        description="tea",
        user=owner,
    )

    e_year, e_month, _ = ethiopian.to_ethiopian(today)
    days = ethiopian.month_length(e_year, e_month)  # 30 for Ethiopian months 1–12
    per_day = round(500000 / days)
    data = client.get("/api/v1/reports/day").data
    s = data["summary"]
    assert data["date_ethiopian"] == ethiopian.format_ethiopian(today)

    assert s["gross_profit"] == 5000
    assert s["direct_expenses"] == 3000  # one-time, in full
    assert s["monthly_prorated"] == per_day  # salary's per-day share only
    assert s["monthly_full"] == 500000
    assert s["expenses_total"] == 3000 + per_day
    assert s["net_profit"] == 5000 - (3000 + per_day)
    # The full salary is NOT charged to the day.
    assert s["expenses_total"] < 500000
    # One-time expenses list the day's actual costs; monthly ones are separate.
    assert [e["description"] for e in data["expenses"]] == ["tea"]
    assert data["monthly_expenses"][0]["amount"] == 500000
    assert data["monthly_expenses"][0]["per_day"] == per_day


def test_day_book_empty_past_day_is_zeroed(shop_with_day):
    shop, client = shop_with_day
    data = client.get("/api/v1/reports/day?date=2000-01-01").data
    assert data["summary"]["sales_total"] == 0
    assert data["summary"]["sales_count"] == 0
    assert data["sales"] == []
    assert data["expenses"] == []
    assert data["by_method"] == []


def test_day_book_is_owner_only(make_user, make_shop, auth):
    owner = make_user("owner2@shopm.local")
    cashier = make_user("cashier@shopm.local")
    shop = make_shop(owner, name="S2", cashier=cashier)
    client = auth(cashier, shop=shop)
    resp = client.get("/api/v1/reports/day")
    assert resp.status_code == 403
