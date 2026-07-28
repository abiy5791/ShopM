"""Owner edit/delete of purchases: stock is reconciled through the ledger and
supplier payable stays in sync (extends plan §7, Phase 3)."""

import pytest

from apps.catalog.models import Product, Supplier
from apps.inventory.models import InventoryTransaction
from apps.inventory.services import ledger_stock, record_transaction
from apps.purchases.models import Purchase

pytestmark = pytest.mark.django_db


def _product(shop, sku="SKU-1", **kw):
    return Product.objects.create(shop=shop, sku=sku, name="Widget", selling_price=1000, **kw)


def _create_purchase(client, product, *, quantity, unit_cost, amount_paid, supplier=None):
    payload = {
        "items": [{"product": str(product.id), "quantity": quantity, "unit_cost": unit_cost}],
        "amount_paid": amount_paid,
    }
    if supplier is not None:
        payload["supplier"] = str(supplier.id)
    resp = client.post("/api/v1/purchases", payload, format="json")
    assert resp.status_code == 201, resp.content
    return resp.data


def test_edit_quantity_adjusts_stock_by_delta(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _product(shop)
    client = auth(owner, shop=shop)

    created = _create_purchase(client, product, quantity=10, unit_cost=500, amount_paid=0)
    product.refresh_from_db()
    assert product.stock_cached == 10

    # Raise the line to 15 → stock should move by +5 to 15.
    resp = client.patch(
        f"/api/v1/purchases/{created['id']}",
        {"items": [{"product": str(product.id), "quantity": 15, "unit_cost": 500}]},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    assert resp.data["total"] == 7500
    product.refresh_from_db()
    assert product.stock_cached == 15
    assert ledger_stock(product) == 15


def test_edit_payment_only_leaves_stock_untouched(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _product(shop)
    client = auth(owner, shop=shop)

    created = _create_purchase(client, product, quantity=10, unit_cost=500, amount_paid=0)
    assert created["payment_status"] == "unpaid"
    ledger_rows_before = InventoryTransaction.objects.filter(product=product).count()

    resp = client.patch(f"/api/v1/purchases/{created['id']}", {"amount_paid": 5000}, format="json")
    assert resp.status_code == 200, resp.content
    assert resp.data["payment_status"] == "paid"
    product.refresh_from_db()
    assert product.stock_cached == 10  # unchanged
    # No new ledger rows for a payment-only edit.
    assert InventoryTransaction.objects.filter(product=product).count() == ledger_rows_before


def test_delete_reverses_stock_and_payable(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _product(shop)
    supplier = Supplier.objects.create(shop=shop, name="Acme")
    client = auth(owner, shop=shop)

    created = _create_purchase(
        client, product, quantity=10, unit_cost=500, amount_paid=2000, supplier=supplier
    )
    supplier.refresh_from_db()
    assert supplier.payable_cached == 3000  # 5000 total - 2000 paid

    resp = client.delete(f"/api/v1/purchases/{created['id']}")
    assert resp.status_code == 204, resp.content
    assert not Purchase.objects.filter(id=created["id"]).exists()
    product.refresh_from_db()
    assert product.stock_cached == 0
    assert ledger_stock(product) == 0
    supplier.refresh_from_db()
    assert supplier.payable_cached == 0


def test_delete_blocked_when_units_already_sold(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _product(shop)
    client = auth(owner, shop=shop)

    created = _create_purchase(client, product, quantity=10, unit_cost=500, amount_paid=0)
    # Sell 6 units out of the ledger, leaving 4 in stock.
    record_transaction(
        product=product, quantity=-6, type=InventoryTransaction.Type.SALE, user=owner
    )
    product.refresh_from_db()
    assert product.stock_cached == 4

    # Reversing the whole purchase (-10) would drive stock to -6 → blocked.
    resp = client.delete(f"/api/v1/purchases/{created['id']}")
    assert resp.status_code == 400, resp.content
    assert resp.data["code"] == "insufficient_stock"
    product.refresh_from_db()
    assert product.stock_cached == 4  # rolled back, nothing changed
    assert Purchase.objects.filter(id=created["id"]).exists()


def test_cashier_cannot_edit_or_delete(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    cashier = make_user("cashier@shopm.local")
    shop = make_shop(owner, name="S", cashier=cashier)
    product = _product(shop)
    owner_client = auth(owner, shop=shop)
    created = _create_purchase(owner_client, product, quantity=5, unit_cost=100, amount_paid=0)

    cashier_client = auth(cashier, shop=shop)
    assert (
        cashier_client.patch(
            f"/api/v1/purchases/{created['id']}", {"amount_paid": 100}, format="json"
        ).status_code
        == 403
    )
    assert cashier_client.delete(f"/api/v1/purchases/{created['id']}").status_code == 403
