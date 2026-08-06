"""The cashier's own-day dashboard (GET /shift)."""

import uuid

import pytest

from apps.catalog.models import Product
from apps.customers.models import Customer
from apps.inventory.services import record_transaction

pytestmark = pytest.mark.django_db


@pytest.fixture
def shop_with_shift(make_user, make_shop, auth):
    """An owner and a cashier who have each rung up sales today.

    Returns ``(shop, as_cashier, as_owner)`` — callables, not clients: the
    `auth` fixture re-credentials one shared APIClient, so a client captured
    now would silently switch identity when the other user logs in.
    """
    owner = make_user("owner@shift.local")
    cashier = make_user("cashier@shift.local", full_name="Meron Haile")
    shop = make_shop(owner, name="Shift", cashier=cashier)
    widget = Product.objects.create(
        shop=shop, sku="SKU-W", name="Widget", selling_price=1000, purchase_price=600
    )
    gadget = Product.objects.create(
        shop=shop,
        sku="SKU-G",
        name="Gadget",
        selling_price=2500,
        purchase_price=2000,
        min_stock_alert=5,
    )
    record_transaction(product=widget, quantity=40, type="adjustment")
    record_transaction(product=gadget, quantity=3, type="adjustment")  # already low

    def sell(client, items):
        total = sum(i["quantity"] * i["price"] for i in items)
        resp = client.post(
            "/api/v1/sales",
            {
                "client_uuid": str(uuid.uuid4()),
                "items": [
                    {"product": str(i["product"].id), "quantity": i["quantity"]} for i in items
                ],
                "payments": [{"method": "cash", "amount": total}],
            },
            format="json",
        )
        assert resp.status_code == 201, resp.content

    sell(auth(owner, shop=shop), [{"product": widget, "quantity": 9, "price": 1000}])
    cashier_client = auth(cashier, shop=shop)
    sell(cashier_client, [{"product": widget, "quantity": 3, "price": 1000}])
    sell(cashier_client, [{"product": widget, "quantity": 1, "price": 1000}])

    return shop, lambda: auth(cashier, shop=shop), lambda: auth(owner, shop=shop)


def test_shift_counts_only_my_own_sales(shop_with_shift):
    shop, as_cashier, _ = shop_with_shift
    data = as_cashier().get("/api/v1/shift").data

    # Two sales of Br30.00 and Br10.00 — the owner's Br90.00 is not mine.
    assert data["today"]["sales_total"] == 4000
    assert data["today"]["sales_count"] == 2
    assert data["today"]["items_sold"] == 4
    assert data["today"]["avg_sale"] == 2000
    assert data["today"]["yesterday_total"] == 0
    assert len(data["recent_sales"]) == 2
    assert data["top_products"] == [{"name": "Widget", "quantity": 4}]


def test_shift_week_series_is_seven_zero_filled_days(shop_with_shift):
    shop, as_cashier, _ = shop_with_shift
    series = as_cashier().get("/api/v1/shift").data["week_series"]

    assert len(series) == 7
    assert series[-1]["total"] == 4000  # today, mine
    assert [d["total"] for d in series[:-1]] == [0] * 6
    assert series[-1]["date"] == as_cashier().get("/api/v1/shift").data["date"]


def test_shift_surfaces_shelf_facts_without_money(shop_with_shift):
    """Low stock and debtors are operational, not financial — a cashier needs
    both at the counter, and neither exposes the shop's profit or valuation."""
    shop, as_cashier, _ = shop_with_shift
    Customer.objects.create(shop=shop, name="Abebe", credit_balance_cached=4500)
    Customer.objects.create(shop=shop, name="Paid Up", credit_balance_cached=0)

    data = as_cashier().get("/api/v1/shift").data

    assert data["low_stock_count"] == 1
    assert [p["name"] for p in data["low_stock"]] == ["Gadget"]
    assert data["low_stock"][0]["stock"] == 3
    assert "purchase_price" not in data["low_stock"][0]
    assert data["debtor_count"] == 1
    assert data["top_debtors"] == [{"name": "Abebe", "balance": 4500}]
    # Nothing shop-wide and financial leaked in.
    assert "cash_balance" not in data
    assert "gross_profit" not in data["today"]


def test_shift_is_per_user_not_per_shop(shop_with_shift):
    """The same endpoint gives the owner their own till, not the shop's."""
    shop, _, as_owner = shop_with_shift
    assert as_owner().get("/api/v1/shift").data["today"]["sales_total"] == 9000


def test_shift_requires_shop_membership(make_user, make_shop, auth):
    owner = make_user("owner-other@shift.local")
    outsider = make_user("outsider@shift.local")
    shop = make_shop(owner, name="Theirs")
    client = auth(outsider, shop=shop)
    assert client.get("/api/v1/shift").status_code == 404


def test_shift_on_a_quiet_day_is_zeroed(shop_with_shift):
    shop, as_cashier, _ = shop_with_shift
    data = as_cashier().get("/api/v1/shift?date=2000-01-01").data
    assert data["today"]["sales_total"] == 0
    assert data["recent_sales"] == []
    assert data["top_products"] == []
    assert len(data["week_series"]) == 7
