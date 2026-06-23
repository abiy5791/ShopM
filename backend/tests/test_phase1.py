"""Phase 1 DoD assertions (plan §11 Phase 1): catalog + ledger-derived stock."""

import pytest

from apps.catalog import excel
from apps.catalog.models import Category, Product
from apps.inventory.models import InventoryTransaction
from apps.inventory.services import ledger_stock, reconcile_shop, record_transaction

pytestmark = pytest.mark.django_db


def _product(shop, sku="SKU-1", **kw):
    defaults = {"name": "Widget", "selling_price": 1000, "min_stock_alert": 5}
    defaults.update(kw)
    return Product.objects.create(shop=shop, sku=sku, **defaults)


# --- DoD: adjustment changes derived stock and writes exactly one ledger row ---
def test_adjustment_writes_one_row_and_updates_cache(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _product(shop)
    client = auth(owner, shop=shop)

    resp = client.post(
        "/api/v1/inventory/adjust",
        {"product": str(product.id), "quantity": 10, "type": "adjustment"},
        format="json",
    )
    assert resp.status_code == 201, resp.content
    assert InventoryTransaction.objects.filter(product=product).count() == 1
    product.refresh_from_db()
    assert product.stock_cached == 10
    assert ledger_stock(product) == 10


# --- DoD: stock_cached always equals SUM(quantity) from the ledger ---
def test_cached_stock_matches_ledger_under_many_writes(make_user, make_shop):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _product(shop)

    deltas = [10, -3, 5, -2, 7, -1, 4, -6, 20, -9]
    for d in deltas:
        record_transaction(product=product, quantity=d, type="adjustment", user=owner)

    product.refresh_from_db()
    assert product.stock_cached == sum(deltas)
    assert ledger_stock(product) == sum(deltas)


# --- DoD: reconciliation reports zero mismatches on consistent data, fixes drift ---
def test_reconcile_zero_on_consistent_then_fixes_forced_drift(make_user, make_shop):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _product(shop)
    record_transaction(product=product, quantity=15, type="adjustment", user=owner)

    assert reconcile_shop(shop, fix=False) == []

    # Force the cache to drift, bypassing the ledger.
    Product.all_objects.filter(pk=product.pk).update(stock_cached=999)
    mismatches = reconcile_shop(shop, fix=True)
    assert len(mismatches) == 1
    assert mismatches[0]["ledger"] == 15
    product.refresh_from_db()
    assert product.stock_cached == 15  # corrected to the ledger


# --- DoD: import/export round-trips without data loss ---
def test_product_excel_round_trip(make_user, make_shop):
    owner = make_user("owner@shopm.local")
    src = make_shop(owner, name="Src")
    dst = make_shop(owner, name="Dst")
    cat = Category.objects.create(shop=src, name="Beverages")
    _product(
        src,
        sku="A-1",
        name="Cola",
        category=cat,
        selling_price=150,
        purchase_price=90,
        min_stock_alert=24,
    )
    _product(src, sku="A-2", name="Water", selling_price=100, purchase_price=60, min_stock_alert=12)

    blob = excel.export_products(Product.objects.filter(shop=src))
    import io

    result = excel.import_products(io.BytesIO(blob), shop=dst)
    assert result["created"] == 2
    assert result["errors"] == []

    original = {p.sku: p for p in Product.objects.filter(shop=src)}
    copied = {p.sku: p for p in Product.objects.filter(shop=dst)}
    assert set(original) == set(copied)
    for sku, src_p in original.items():
        dst_p = copied[sku]
        assert dst_p.name == src_p.name
        assert dst_p.selling_price == src_p.selling_price
        assert dst_p.purchase_price == src_p.purchase_price
        assert dst_p.min_stock_alert == src_p.min_stock_alert
        # Category recreated by name in the destination shop.
        assert (dst_p.category.name if dst_p.category else None) == (
            src_p.category.name if src_p.category else None
        )


# --- DoD: cashier can view products but cannot edit them (backend-enforced) ---
def test_cashier_reads_but_cannot_write_products(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    cashier = make_user("cashier@shopm.local")
    shop = make_shop(owner, name="S", cashier=cashier)
    _product(shop, sku="P-1")
    client = auth(cashier, shop=shop)

    assert client.get("/api/v1/products").status_code == 200
    create = client.post(
        "/api/v1/products",
        {"name": "X", "sku": "NEW", "selling_price": 100},
        format="json",
    )
    assert create.status_code == 403


def test_cashier_cannot_adjust_stock(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    cashier = make_user("cashier@shopm.local")
    shop = make_shop(owner, name="S", cashier=cashier)
    product = _product(shop, sku="P-1")
    client = auth(cashier, shop=shop)
    resp = client.post(
        "/api/v1/inventory/adjust",
        {"product": str(product.id), "quantity": 5, "type": "adjustment"},
        format="json",
    )
    assert resp.status_code == 403


def test_product_stock_endpoint_returns_ledger(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _product(shop)
    record_transaction(product=product, quantity=42, type="adjustment", user=owner)
    client = auth(owner, shop=shop)
    resp = client.get(f"/api/v1/products/{product.id}/stock")
    assert resp.status_code == 200
    assert resp.data["ledger_stock"] == 42
    assert resp.data["stock_cached"] == 42
