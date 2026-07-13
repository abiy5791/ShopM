"""Phase D (v2 plan §5): small correctness fixes."""

import uuid

import pytest

from apps.catalog.models import Product
from apps.inventory.services import record_transaction
from apps.shops.models import ShopSettings

pytestmark = pytest.mark.django_db


@pytest.fixture
def shop_client(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    return shop, auth(owner, shop=shop)


def test_new_product_inherits_shop_low_stock_default(shop_client):
    shop, client = shop_client
    ShopSettings.objects.filter(shop=shop).update(low_stock_default=7)

    resp = client.post(
        "/api/v1/products",
        {"name": "Widget", "sku": "SKU-1", "selling_price": 1000},
        format="json",
    )
    assert resp.status_code == 201, resp.content
    assert resp.data["min_stock_alert"] == 7

    # An explicit value still wins.
    resp = client.post(
        "/api/v1/products",
        {"name": "Gadget", "sku": "SKU-2", "selling_price": 1000, "min_stock_alert": 2},
        format="json",
    )
    assert resp.data["min_stock_alert"] == 2


def test_zero_amount_payment_is_rejected(shop_client):
    shop, client = shop_client
    product = Product.objects.create(shop=shop, sku="SKU-1", name="Widget", selling_price=1000)
    record_transaction(product=product, quantity=5, type="adjustment")

    resp = client.post(
        "/api/v1/sales",
        {
            "client_uuid": str(uuid.uuid4()),
            "items": [{"product": str(product.id), "quantity": 1}],
            "payments": [{"method": "cash", "amount": 0}],
        },
        format="json",
    )
    assert resp.status_code == 400
    assert resp.data["code"] == "validation_error"
