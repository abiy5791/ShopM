"""Phase 2 DoD assertions (plan §11 Phase 2): POS / sales."""

import uuid

import pytest

from apps.activity.models import ActivityLog
from apps.catalog.models import Product
from apps.inventory.services import ledger_stock, record_transaction
from apps.sales.models import Sale

pytestmark = pytest.mark.django_db


def _stocked_product(shop, sku="SKU-1", price=1000, opening=50, **kw):
    product = Product.objects.create(shop=shop, sku=sku, name="Widget", selling_price=price, **kw)
    if opening:
        record_transaction(product=product, quantity=opening, type="adjustment")
    product.refresh_from_db()
    return product


def _sale_payload(product, qty=3, uuid_str=None, pay=None):
    line_total = product.selling_price * qty
    return {
        "client_uuid": uuid_str or str(uuid.uuid4()),
        "items": [{"product": str(product.id), "quantity": qty}],
        "payments": [{"method": "cash", "amount": pay if pay is not None else line_total}],
    }


def test_sale_decrements_stock_by_sold_quantity(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _stocked_product(shop, opening=50)
    client = auth(owner, shop=shop)

    resp = client.post("/api/v1/sales", _sale_payload(product, qty=3), format="json")
    assert resp.status_code == 201, resp.content
    product.refresh_from_db()
    assert product.stock_cached == 47
    assert ledger_stock(product) == 47


def test_replaying_client_uuid_is_idempotent(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _stocked_product(shop, opening=50)
    client = auth(owner, shop=shop)

    payload = _sale_payload(product, qty=2)
    first = client.post("/api/v1/sales", payload, format="json")
    assert first.status_code == 201
    second = client.post("/api/v1/sales", payload, format="json")
    assert second.status_code == 200  # replay, not a duplicate
    assert second.data["id"] == first.data["id"]
    assert Sale.objects.count() == 1
    product.refresh_from_db()
    assert product.stock_cached == 48  # decremented once only


def test_change_is_computed(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _stocked_product(shop, price=1000, opening=10)
    client = auth(owner, shop=shop)
    payload = _sale_payload(product, qty=2, pay=2500)  # total 2000, tendered 2500
    resp = client.post("/api/v1/sales", payload, format="json")
    assert resp.status_code == 201
    assert resp.data["total"] == 2000
    assert resp.data["change"] == 500


def test_underpayment_is_rejected(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _stocked_product(shop, price=1000, opening=10)
    client = auth(owner, shop=shop)
    payload = _sale_payload(product, qty=2, pay=1500)  # owes 2000
    resp = client.post("/api/v1/sales", payload, format="json")
    assert resp.status_code == 400
    assert resp.data["code"] == "checkout_error"


def test_void_reverses_stock_and_is_logged(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _stocked_product(shop, opening=50)
    client = auth(owner, shop=shop)

    sale = client.post("/api/v1/sales", _sale_payload(product, qty=4), format="json").data
    product.refresh_from_db()
    assert product.stock_cached == 46

    resp = client.post(f"/api/v1/sales/{sale['id']}/void", format="json")
    assert resp.status_code == 200
    assert resp.data["status"] == "voided"
    product.refresh_from_db()
    assert product.stock_cached == 50  # fully restored
    assert ledger_stock(product) == 50
    assert ActivityLog.objects.filter(action="sale.void", shop=shop).exists()


def test_price_change_does_not_alter_past_receipt(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _stocked_product(shop, price=1000, opening=10)
    client = auth(owner, shop=shop)

    sale = client.post("/api/v1/sales", _sale_payload(product, qty=2), format="json").data
    # Change the product's price after the sale.
    product.selling_price = 5000
    product.save(update_fields=["selling_price"])

    receipt = client.get(f"/api/v1/sales/{sale['id']}/receipt").data
    assert receipt["items"][0]["unit_price_snapshot"] == 1000  # snapshot unchanged
    assert receipt["total"] == 2000


def test_cashier_can_sell_but_not_void(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    cashier = make_user("cashier@shopm.local")
    shop = make_shop(owner, name="S", cashier=cashier)
    product = _stocked_product(shop, opening=20)
    client = auth(cashier, shop=shop)

    sale = client.post("/api/v1/sales", _sale_payload(product, qty=1), format="json")
    assert sale.status_code == 201
    void = client.post(f"/api/v1/sales/{sale.data['id']}/void", format="json")
    assert void.status_code == 403
