"""Phase 4 DoD assertions (plan §11 Phase 4): customers & credit."""

import uuid

import pytest

from apps.catalog.models import Product, Supplier
from apps.customers.models import Customer
from apps.customers.services import derived_balance
from apps.inventory.services import record_transaction
from apps.purchases.services import create_purchase
from apps.sales.services import create_sale, void_sale

pytestmark = pytest.mark.django_db


def _stocked_product(shop, opening=100, price=1000):
    p = Product.objects.create(shop=shop, sku="SKU-1", name="Widget", selling_price=price)
    record_transaction(product=p, quantity=opening, type="adjustment")
    return p


def _credit_sale(shop, cashier, customer, product, qty=5, paid=0):
    return create_sale(
        shop=shop,
        cashier=cashier,
        client_uuid=str(uuid.uuid4()),
        items=[{"product": product, "quantity": qty}],
        payments=[{"method": "cash", "amount": paid}] if paid else [],
        customer=customer,
    )


# --- DoD: a credit sale increases balance by exactly the unpaid amount ---
def test_credit_sale_raises_balance(make_user, make_shop):
    owner = make_user("o@shopm.local")
    shop = make_shop(owner, name="S")
    product = _stocked_product(shop, price=1000)
    customer = Customer.objects.create(shop=shop, name="Jo")

    _credit_sale(shop, owner, customer, product, qty=5, paid=2000)  # total 5000, paid 2000
    customer.refresh_from_db()
    assert customer.credit_balance_cached == 3000
    assert derived_balance(customer) == 3000


def test_fully_on_credit_sale(make_user, make_shop):
    owner = make_user("o@shopm.local")
    shop = make_shop(owner, name="S")
    product = _stocked_product(shop, price=1000)
    customer = Customer.objects.create(shop=shop, name="Jo")

    _credit_sale(shop, owner, customer, product, qty=3, paid=0)  # total 3000, nothing paid
    customer.refresh_from_db()
    assert customer.credit_balance_cached == 3000


# --- DoD: settlement reduces balance; cached == derived ---
def test_settlement_reduces_balance(make_user, make_shop, auth):
    owner = make_user("o@shopm.local")
    shop = make_shop(owner, name="S")
    product = _stocked_product(shop, price=1000)
    customer = Customer.objects.create(shop=shop, name="Jo")
    _credit_sale(shop, owner, customer, product, qty=5, paid=0)  # owes 5000

    client = auth(owner, shop=shop)
    resp = client.post(
        "/api/v1/payments",
        {"customer": str(customer.id), "method": "cash", "amount": 2000},
        format="json",
    )
    assert resp.status_code == 201, resp.content
    assert resp.data["balance"] == 3000
    customer.refresh_from_db()
    assert customer.credit_balance_cached == derived_balance(customer) == 3000


def test_voiding_credit_sale_clears_its_balance(make_user, make_shop):
    owner = make_user("o@shopm.local")
    shop = make_shop(owner, name="S")
    product = _stocked_product(shop, price=1000)
    customer = Customer.objects.create(shop=shop, name="Jo")
    sale, _ = _credit_sale(shop, owner, customer, product, qty=4, paid=1000)  # owes 3000
    customer.refresh_from_db()
    assert customer.credit_balance_cached == 3000

    void_sale(sale, user=owner)
    customer.refresh_from_db()
    # Sale total and its checkout payment both drop out → back to zero.
    assert customer.credit_balance_cached == 0
    assert derived_balance(customer) == 0


def test_cashier_can_manage_customers(make_user, make_shop, auth):
    owner = make_user("o@shopm.local")
    cashier = make_user("c@shopm.local")
    shop = make_shop(owner, name="S", cashier=cashier)
    client = auth(cashier, shop=shop)
    resp = client.post("/api/v1/customers", {"name": "Walk-in Jo"}, format="json")
    assert resp.status_code == 201


# --- DoD: supplier payable mirrors the pattern ---
def test_supplier_payable_mirrors(make_user, make_shop):
    owner = make_user("o@shopm.local")
    shop = make_shop(owner, name="S")
    product = _stocked_product(shop)
    supplier = Supplier.objects.create(shop=shop, name="Acme")

    create_purchase(
        shop=shop,
        user=owner,
        supplier=supplier,
        items=[{"product": product, "quantity": 10, "unit_cost": 1000}],  # total 10000
        amount_paid=4000,
    )
    supplier.refresh_from_db()
    assert supplier.payable_cached == 6000  # owes 6000
