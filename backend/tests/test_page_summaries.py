"""KPI card rows above each list table (GET /<resource>/summary)."""

import uuid

import pytest
from django.utils import timezone

from apps.catalog.models import Product, Supplier
from apps.common import ethiopian
from apps.customers.models import Customer
from apps.expenses.models import Expense, ExpenseCategory
from apps.inventory.services import record_transaction
from apps.purchases.models import Purchase
from apps.sales.models import Payment

pytestmark = pytest.mark.django_db


def cards(response) -> dict:
    """Cards keyed by their `key`, so assertions read by name not by position."""
    assert response.status_code == 200, response.content
    return {c["key"]: c for c in response.data["cards"]}


@pytest.fixture
def shop_with_data(make_user, make_shop, auth):
    """One shop with a product, a cash sale, a supplier purchase and an expense."""
    owner = make_user("owner@summaries.local")
    shop = make_shop(owner, name="S")
    widget = Product.objects.create(
        shop=shop, sku="SKU-1", name="Widget", selling_price=1000, purchase_price=600
    )
    Product.objects.create(
        shop=shop,
        sku="SKU-2",
        name="Dormant",
        selling_price=500,
        purchase_price=200,
        status=Product.Status.INACTIVE,
    )
    record_transaction(product=widget, quantity=10, type="adjustment")
    client = auth(owner, shop=shop)
    resp = client.post(
        "/api/v1/sales",
        {
            "client_uuid": str(uuid.uuid4()),
            "items": [{"product": str(widget.id), "quantity": 2}],
            "payments": [{"method": "cash", "amount": 2000}],
        },
        format="json",
    )
    assert resp.status_code == 201, resp.content
    return shop, client, widget


# ---------------------------------------------------------------- products
def test_products_summary_counts_and_valuation(shop_with_data):
    shop, client, widget = shop_with_data
    c = cards(client.get("/api/v1/products/summary"))

    assert c["products"]["value"] == 2
    assert c["products"]["hint"] == "1 active · 1 inactive"
    # Dormant has 0 stock and a 0 alert threshold, so it counts as low AND out.
    assert c["low_stock"]["value"] == 1
    assert c["low_stock"]["hint"] == "1 out of stock"
    # 8 left after selling 2 of 10, at the Br6.00 purchase price.
    assert c["stock_value"]["value"] == 8 * 600
    assert c["retail_value"]["value"] == 8 * 1000
    assert c["stock_value"]["money"] is True


def test_products_summary_hides_valuation_from_cashiers(make_user, make_shop, auth):
    """A cashier gets the same page with stock counts where the money was."""
    owner = make_user("owner-p@summaries.local")
    cashier = make_user("cashier-p@summaries.local")
    shop = make_shop(owner, name="P", cashier=cashier)
    Product.objects.create(
        shop=shop, sku="SKU-P", name="Widget", selling_price=1000, purchase_price=600
    )

    c = cards(auth(cashier, shop=shop).get("/api/v1/products/summary"))
    assert set(c) == {"products", "low_stock", "out_of_stock", "units"}
    assert c["products"]["value"] == 1
    assert c["out_of_stock"]["value"] == 1  # no stock posted yet
    # Nothing on the cashier's row is money.
    assert all(card["money"] is False for card in c.values())


# ---------------------------------------------------------------- sales
def test_sales_summary_today_and_month(shop_with_data):
    shop, client, _ = shop_with_data
    c = cards(client.get("/api/v1/sales/summary"))

    assert c["today"]["value"] == 2000
    assert c["today"]["hint"] == "1 sale"
    assert c["today"]["delta"] == {"current": 2000, "previous": 0, "label": "vs yesterday"}
    assert c["month"]["value"] == 2000
    assert c["avg_sale"]["value"] == 2000
    assert c["avg_sale"]["hint"] == "2 items sold this month"
    # Paid in full at the till — nothing outstanding.
    assert c["on_credit"]["value"] == 0
    assert c["on_credit"]["tone"] == "default"


def test_sales_summary_flags_unpaid_credit(shop_with_data):
    """A part-paid sale leaves the balance sitting in "Sold on credit"."""
    shop, client, widget = shop_with_data
    customer = Customer.objects.create(shop=shop, name="Debtor")
    resp = client.post(
        "/api/v1/sales",
        {
            "client_uuid": str(uuid.uuid4()),
            "items": [{"product": str(widget.id), "quantity": 3}],
            "customer": str(customer.id),
            "payments": [{"method": "cash", "amount": 1000}],
        },
        format="json",
    )
    assert resp.status_code == 201, resp.content

    c = cards(client.get("/api/v1/sales/summary"))
    assert c["month"]["value"] == 2000 + 3000
    assert c["on_credit"]["value"] == 3000 - 1000  # billed but not collected
    assert c["on_credit"]["tone"] == "warning"


def test_sales_summary_scopes_to_own_till_for_cashiers(make_user, make_shop, auth):
    """A cashier's cards count their own sales — never the shop's takings."""
    owner = make_user("owner-s@summaries.local")
    cashier = make_user("cashier-s@summaries.local")
    shop = make_shop(owner, name="S2", cashier=cashier)
    product = Product.objects.create(
        shop=shop, sku="SKU-S", name="Widget", selling_price=1000, purchase_price=600
    )
    record_transaction(product=product, quantity=20, type="adjustment")

    def sell(client, quantity):
        resp = client.post(
            "/api/v1/sales",
            {
                "client_uuid": str(uuid.uuid4()),
                "items": [{"product": str(product.id), "quantity": quantity}],
                "payments": [{"method": "cash", "amount": quantity * 1000}],
            },
            format="json",
        )
        assert resp.status_code == 201, resp.content

    sell(auth(owner, shop=shop), 5)  # the owner rings up Br50.00
    cashier_client = auth(cashier, shop=shop)
    sell(cashier_client, 2)  # the cashier rings up Br20.00

    c = cards(cashier_client.get("/api/v1/sales/summary"))
    assert set(c) == {"today", "items_today", "avg_sale", "week_takings"}
    assert c["today"]["label"] == "My sales today"
    assert c["today"]["value"] == 2000  # their own 2 units, not the owner's 5
    assert c["items_today"]["value"] == 2
    assert c["avg_sale"]["value"] == 2000
    assert c["week_takings"]["value"] == 2000

    # The owner still sees the whole shop on the same endpoint.
    owner_cards = cards(auth(owner, shop=shop).get("/api/v1/sales/summary"))
    assert owner_cards["today"]["value"] == 7000


# ---------------------------------------------------------------- customers
def test_customers_summary_credit(shop_with_data):
    shop, client, _ = shop_with_data
    Customer.objects.create(shop=shop, name="Abebe", credit_balance_cached=4500)
    Customer.objects.create(shop=shop, name="Kebede", credit_balance_cached=0)
    Payment.objects.create(shop=shop, sale=None, method="cash", amount=700, user=shop.owner)

    c = cards(client.get("/api/v1/customers/summary"))
    assert c["customers"]["value"] == 2
    assert c["credit"]["value"] == 4500
    assert c["credit"]["hint"] == "1 customer with a balance"
    assert c["largest_balance"]["value"] == 4500
    assert c["largest_balance"]["hint"] == "Abebe"
    assert c["settled"]["value"] == 700  # standalone payment = debt settled


def test_customers_summary_open_to_cashiers(make_user, make_shop, auth):
    """Credit balances are already on the customer list, so the row isn't gated."""
    owner = make_user("owner-c@summaries.local")
    cashier = make_user("cashier-c@summaries.local")
    shop = make_shop(owner, name="C", cashier=cashier)
    assert auth(cashier, shop=shop).get("/api/v1/customers/summary").status_code == 200


# ---------------------------------------------------------------- purchases
def test_purchases_summary_spend_and_payable(shop_with_data):
    shop, client, widget = shop_with_data
    supplier = Supplier.objects.create(shop=shop, name="Acme")
    resp = client.post(
        "/api/v1/purchases",
        {
            "supplier": str(supplier.id),
            "items": [{"product": str(widget.id), "quantity": 5, "unit_cost": 600}],
            "amount_paid": 1000,
        },
        format="json",
    )
    assert resp.status_code == 201, resp.content

    c = cards(client.get("/api/v1/purchases/summary"))
    assert c["month_spend"]["value"] == 3000
    assert c["month_spend"]["hint"] == "1 purchase"
    assert c["paid"]["value"] == 1000
    assert c["outstanding"]["value"] == 2000
    assert c["outstanding"]["tone"] == "warning"
    assert c["top_supplier"]["value"] == 3000
    assert c["top_supplier"]["hint"] == "Acme"


# ---------------------------------------------------------------- suppliers
def test_suppliers_summary_payable(shop_with_data):
    shop, client, widget = shop_with_data
    supplier = Supplier.objects.create(shop=shop, name="Acme")
    Supplier.objects.create(shop=shop, name="Settled Co")
    Purchase.objects.create(
        shop=shop,
        supplier=supplier,
        total=3000,
        amount_paid=1000,
        payment_status=Purchase.PaymentStatus.PARTIAL,
        date=timezone.now().date(),
        user=shop.owner,
    )
    supplier.payable_cached = 2000
    supplier.save(update_fields=["payable_cached"])

    c = cards(client.get("/api/v1/suppliers/summary"))
    assert c["suppliers"]["value"] == 2
    assert c["suppliers"]["hint"] == "1 with an open balance"
    assert c["payable"]["value"] == 2000
    assert c["month_spend"]["value"] == 3000
    assert c["biggest_supplier"]["hint"] == "Acme"


# ---------------------------------------------------------------- expenses
def test_expenses_summary_month_and_recurring(shop_with_data):
    shop, client, _ = shop_with_data
    today = timezone.now().date()
    rent = ExpenseCategory.objects.create(shop=shop, name="Rent")
    Expense.objects.create(
        shop=shop, category=rent, amount=9000, date=today, description="", user=shop.owner
    )
    Expense.objects.create(
        shop=shop,
        amount=1000,
        date=today,
        recurrence=Expense.Recurrence.MONTHLY,
        user=shop.owner,
    )

    _, _, day_of_month = ethiopian.to_ethiopian(today)
    c = cards(client.get("/api/v1/expenses/summary"))
    assert c["month"]["value"] == 10000
    assert c["month"]["hint"] == "2 expenses"
    assert c["per_day"]["value"] == round(10000 / day_of_month)
    assert c["top_category"]["value"] == 9000
    assert c["top_category"]["hint"] == "Rent"
    assert c["recurring"]["value"] == 1000


def test_expenses_summary_empty_shop_is_zeroed(make_user, make_shop, auth):
    owner = make_user("owner-e@summaries.local")
    shop = make_shop(owner, name="E")
    c = cards(auth(owner, shop=shop).get("/api/v1/expenses/summary"))
    assert [card["value"] for card in c.values()] == [0, 0, 0, 0]
    assert c["top_category"]["hint"] == "Nothing spent yet"


# ---------------------------------------------------------------- activity
def test_activity_summary_counts_todays_events(shop_with_data):
    shop, client, _ = shop_with_data  # the sale above logged sale.create
    c = cards(client.get("/api/v1/activity/summary"))
    assert c["events_today"]["value"] >= 1
    assert c["events_week"]["value"] >= 1
    assert c["active_staff"]["value"] == 1


def test_activity_summary_scopes_to_own_rows_for_cashiers(make_user, make_shop, auth):
    """Cashiers list only their own audit rows, so their KPIs must count only those."""
    owner = make_user("owner-a@summaries.local")
    cashier = make_user("cashier-a@summaries.local")
    shop = make_shop(owner, name="A", cashier=cashier)
    product = Product.objects.create(
        shop=shop, sku="SKU-A", name="Widget", selling_price=1000, purchase_price=600
    )
    record_transaction(product=product, quantity=5, type="adjustment")
    # The owner acts; the cashier does nothing.
    owner_client = auth(owner, shop=shop)
    owner_client.post(
        "/api/v1/sales",
        {
            "client_uuid": str(uuid.uuid4()),
            "items": [{"product": str(product.id), "quantity": 1}],
            "payments": [{"method": "cash", "amount": 1000}],
        },
        format="json",
    )
    assert cards(owner_client.get("/api/v1/activity/summary"))["events_today"]["value"] >= 1
    cashier_cards = cards(auth(cashier, shop=shop).get("/api/v1/activity/summary"))
    assert cashier_cards["events_today"]["value"] == 0


def test_summaries_are_scoped_to_the_active_shop(make_user, make_shop, auth):
    """A second shop's data must never leak into the first shop's cards."""
    owner = make_user("owner-multi@summaries.local")
    first = make_shop(owner, name="First")
    second = make_shop(owner, name="Second")
    Product.objects.create(
        shop=second, sku="SKU-X", name="Other", selling_price=100, purchase_price=50
    )

    client = auth(owner, shop=first)
    assert cards(client.get("/api/v1/products/summary"))["products"]["value"] == 0
    client = auth(owner, shop=second)
    assert cards(client.get("/api/v1/products/summary"))["products"]["value"] == 1
