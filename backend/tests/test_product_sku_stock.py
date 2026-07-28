"""Auto-generated SKU, opening stock, and the units lookup for products."""

import pytest

from apps.catalog.models import Category, Product

pytestmark = pytest.mark.django_db


@pytest.fixture
def owner_client(make_user, make_shop, auth):
    owner = make_user("owner-sku@shopm.local")
    shop = make_shop(owner, name="S")
    return shop, auth(owner, shop=shop)


def test_sku_is_auto_generated_from_category(owner_client):
    shop, client = owner_client
    cat = Category.objects.create(shop=shop, name="Menswear")
    resp = client.post(
        "/api/v1/products",
        {"name": "Blazer", "category": str(cat.id), "selling_price": 1000},
        format="json",
    )
    assert resp.status_code == 201, resp.content
    assert resp.data["sku"] == "MEN-001"  # category prefix + sequence

    # A second product in the same category takes the next number.
    resp2 = client.post(
        "/api/v1/products",
        {"name": "Coat", "category": str(cat.id), "selling_price": 2000},
        format="json",
    )
    assert resp2.data["sku"] == "MEN-002"

    # Uncategorised falls back to the GEN prefix.
    resp3 = client.post("/api/v1/products", {"name": "Misc", "selling_price": 50}, format="json")
    assert resp3.data["sku"] == "GEN-001"


def test_explicit_sku_still_honoured(owner_client):
    shop, client = owner_client
    resp = client.post(
        "/api/v1/products",
        {"name": "Custom", "sku": "MY-CODE", "selling_price": 100},
        format="json",
    )
    assert resp.status_code == 201
    assert resp.data["sku"] == "MY-CODE"


def test_opening_stock_posts_to_ledger(owner_client):
    shop, client = owner_client
    resp = client.post(
        "/api/v1/products",
        {"name": "Socks", "selling_price": 100, "initial_stock": 25},
        format="json",
    )
    assert resp.status_code == 201
    product = Product.objects.get(id=resp.data["id"])
    assert product.stock_cached == 25
    # It went through the ledger, not a raw write.
    from apps.inventory.services import ledger_stock

    assert ledger_stock(product) == 25


def test_units_lookup_returns_distinct_shop_units(owner_client):
    shop, client = owner_client
    Product.objects.create(shop=shop, name="A", sku="A-1", unit="kg", selling_price=1)
    Product.objects.create(shop=shop, name="B", sku="B-1", unit="pcs", selling_price=1)
    Product.objects.create(shop=shop, name="C", sku="C-1", unit="kg", selling_price=1)
    data = client.get("/api/v1/products/units").data
    assert data == ["kg", "pcs"]
