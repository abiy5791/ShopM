"""Phase A (v2 plan §2): selling is bound to live stock.

A sale may never take stock below zero — enforced by the pre-check in
``_check_stock`` (row-locked on PostgreSQL) and backstopped by the atomic
conditional UPDATE in ``record_transaction``, which holds on every backend.
"""

import uuid

import pytest

from apps.catalog.models import Product
from apps.inventory.models import InventoryTransaction
from apps.inventory.services import NegativeStockError, ledger_stock, record_transaction
from apps.sales.models import Sale

pytestmark = pytest.mark.django_db


def _stocked_product(shop, sku="SKU-1", price=1000, opening=50, **kw):
    product = Product.objects.create(shop=shop, sku=sku, name="Widget", selling_price=price, **kw)
    if opening:
        record_transaction(product=product, quantity=opening, type="adjustment")
    product.refresh_from_db()
    return product


def _sale_payload(*lines, pay=None):
    """lines: (product, qty) tuples; pay defaults to the exact total."""
    total = sum(p.selling_price * q for p, q in lines)
    return {
        "client_uuid": str(uuid.uuid4()),
        "items": [{"product": str(p.id), "quantity": q} for p, q in lines],
        "payments": [{"method": "cash", "amount": pay if pay is not None else total}],
    }


@pytest.fixture
def shop_client(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    return shop, auth(owner, shop=shop)


# ---------------------------------------------------------------- checkout
def test_oversell_is_rejected_with_structured_shortages(shop_client):
    shop, client = shop_client
    product = _stocked_product(shop, opening=2)

    resp = client.post("/api/v1/sales", _sale_payload((product, 5)), format="json")

    assert resp.status_code == 400, resp.content
    assert resp.data["code"] == "insufficient_stock"
    shortage = resp.data["fields"][str(product.id)]
    assert shortage["requested"] == 5
    assert shortage["available"] == 2
    assert shortage["sku"] == product.sku
    # Nothing was written: no sale, no ledger row, stock unchanged.
    assert Sale.objects.count() == 0
    product.refresh_from_db()
    assert product.stock_cached == 2
    assert ledger_stock(product) == 2


def test_sale_of_exact_stock_succeeds_and_leaves_zero(shop_client):
    shop, client = shop_client
    product = _stocked_product(shop, opening=3)

    resp = client.post("/api/v1/sales", _sale_payload((product, 3)), format="json")

    assert resp.status_code == 201, resp.content
    product.refresh_from_db()
    assert product.stock_cached == 0
    assert ledger_stock(product) == 0


def test_sale_at_zero_stock_is_rejected(shop_client):
    shop, client = shop_client
    product = _stocked_product(shop, opening=0)

    resp = client.post("/api/v1/sales", _sale_payload((product, 1)), format="json")

    assert resp.status_code == 400
    assert resp.data["code"] == "insufficient_stock"
    assert resp.data["fields"][str(product.id)]["available"] == 0


def test_duplicate_lines_for_one_product_are_summed(shop_client):
    shop, client = shop_client
    product = _stocked_product(shop, opening=3)

    payload = {
        "client_uuid": str(uuid.uuid4()),
        "items": [
            {"product": str(product.id), "quantity": 2},
            {"product": str(product.id), "quantity": 2},  # 4 total > 3 available
        ],
        "payments": [{"method": "cash", "amount": product.selling_price * 4}],
    }
    resp = client.post("/api/v1/sales", payload, format="json")

    assert resp.status_code == 400
    assert resp.data["fields"][str(product.id)]["requested"] == 4


def test_one_short_line_rejects_the_whole_sale_atomically(shop_client):
    shop, client = shop_client
    plenty = _stocked_product(shop, sku="SKU-A", opening=50)
    scarce = _stocked_product(shop, sku="SKU-B", opening=1)

    resp = client.post("/api/v1/sales", _sale_payload((plenty, 2), (scarce, 3)), format="json")

    assert resp.status_code == 400
    assert list(resp.data["fields"].keys()) == [str(scarce.id)]  # only the short line
    # The in-stock line was not decremented either.
    plenty.refresh_from_db()
    assert plenty.stock_cached == 50
    assert Sale.objects.count() == 0


def test_selling_to_zero_then_selling_again_is_rejected(shop_client):
    shop, client = shop_client
    product = _stocked_product(shop, opening=1)

    first = client.post("/api/v1/sales", _sale_payload((product, 1)), format="json")
    assert first.status_code == 201
    second = client.post("/api/v1/sales", _sale_payload((product, 1)), format="json")
    assert second.status_code == 400
    assert second.data["code"] == "insufficient_stock"


def test_void_restores_stock_and_item_is_sellable_again(shop_client):
    shop, client = shop_client
    product = _stocked_product(shop, opening=1)

    sale = client.post("/api/v1/sales", _sale_payload((product, 1)), format="json").data
    client.post(f"/api/v1/sales/{sale['id']}/void", format="json")

    resp = client.post("/api/v1/sales", _sale_payload((product, 1)), format="json")
    assert resp.status_code == 201, resp.content


def test_inactive_product_cannot_be_sold(shop_client):
    shop, client = shop_client
    product = _stocked_product(shop, opening=10, status=Product.Status.INACTIVE)

    resp = client.post("/api/v1/sales", _sale_payload((product, 1)), format="json")

    assert resp.status_code == 400
    assert resp.data["code"] == "validation_error"


# ------------------------------------------------------- ledger floor guard
def test_record_transaction_floors_negative_stock(make_user, make_shop):
    """The conditional UPDATE is the race backstop: even a caller that skipped
    the pre-check (e.g. a racing sale on SQLite) cannot push stock below zero."""
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _stocked_product(shop, opening=2)

    with pytest.raises(NegativeStockError) as excinfo:
        record_transaction(product=product, quantity=-3, type="sale")

    assert excinfo.value.requested == 3
    assert excinfo.value.available == 2
    # The rolled-back attempt left no ledger row and no stock change.
    product.refresh_from_db()
    assert product.stock_cached == 2
    assert InventoryTransaction.objects.filter(product=product).count() == 1  # opening only


def test_record_transaction_allows_decrement_to_exactly_zero(make_user, make_shop):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _stocked_product(shop, opening=2)

    record_transaction(product=product, quantity=-2, type="sale")

    product.refresh_from_db()
    assert product.stock_cached == 0


# ------------------------------------------------------- manual adjustments
def test_negative_adjustment_below_zero_is_rejected(shop_client):
    shop, client = shop_client
    product = _stocked_product(shop, opening=2)

    resp = client.post(
        "/api/v1/inventory/adjust",
        {"product": str(product.id), "quantity": -5, "type": "damage"},
        format="json",
    )

    assert resp.status_code == 400, resp.content
    assert resp.data["code"] == "adjustment_below_zero"
    product.refresh_from_db()
    assert product.stock_cached == 2
    assert ledger_stock(product) == 2


def test_negative_adjustment_to_exactly_zero_succeeds(shop_client):
    shop, client = shop_client
    product = _stocked_product(shop, opening=2)

    resp = client.post(
        "/api/v1/inventory/adjust",
        {"product": str(product.id), "quantity": -2, "type": "adjustment"},
        format="json",
    )

    assert resp.status_code == 201, resp.content
    product.refresh_from_db()
    assert product.stock_cached == 0
