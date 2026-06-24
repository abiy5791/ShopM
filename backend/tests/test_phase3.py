"""Phase 3 DoD assertions (plan §11 Phase 3): purchases & expenses."""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.catalog.models import Product, Supplier
from apps.expenses.models import ExpenseCategory
from apps.inventory.services import ledger_stock

pytestmark = pytest.mark.django_db


def _product(shop, sku="SKU-1", **kw):
    return Product.objects.create(shop=shop, sku=sku, name="Widget", selling_price=1000, **kw)


# --- DoD: recording a purchase increases stock by the purchased quantity ---
def test_purchase_stocks_in(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _product(shop)
    supplier = Supplier.objects.create(shop=shop, name="Acme")
    client = auth(owner, shop=shop)

    payload = {
        "supplier": str(supplier.id),
        "items": [{"product": str(product.id), "quantity": 20, "unit_cost": 600}],
        "amount_paid": 12000,
    }
    resp = client.post("/api/v1/purchases", payload, format="json")
    assert resp.status_code == 201, resp.content
    assert resp.data["total"] == 12000
    assert resp.data["payment_status"] == "paid"
    product.refresh_from_db()
    assert product.stock_cached == 20
    assert ledger_stock(product) == 20


def test_partial_payment_status(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    product = _product(shop)
    client = auth(owner, shop=shop)
    payload = {
        "items": [{"product": str(product.id), "quantity": 10, "unit_cost": 1000}],
        "amount_paid": 4000,  # owes 6000
    }
    resp = client.post("/api/v1/purchases", payload, format="json")
    assert resp.status_code == 201
    assert resp.data["payment_status"] == "partial"


def test_cashier_cannot_access_purchases(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    cashier = make_user("cashier@shopm.local")
    shop = make_shop(owner, name="S", cashier=cashier)
    product = _product(shop)
    client = auth(cashier, shop=shop)

    assert client.get("/api/v1/purchases").status_code == 403
    create = client.post(
        "/api/v1/purchases",
        {"items": [{"product": str(product.id), "quantity": 1, "unit_cost": 100}]},
        format="json",
    )
    assert create.status_code == 403


# --- DoD: expense image uploads work ---
def test_expense_with_image_upload(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    category = ExpenseCategory.objects.create(shop=shop, name="Rent")
    client = auth(owner, shop=shop)

    image = SimpleUploadedFile("receipt.png", b"\x89PNG\r\n\x1a\nfake", content_type="image/png")
    resp = client.post(
        "/api/v1/expenses",
        {
            "category": str(category.id),
            "amount": 50000,
            "date": "2026-06-01",
            "description": "June rent",
            "receipt_image": image,
        },
        format="multipart",
    )
    assert resp.status_code == 201, resp.content
    assert resp.data["receipt_image_url"]
    assert resp.data["category_name"] == "Rent"


def test_expense_rejects_bad_file_type(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="S")
    client = auth(owner, shop=shop)
    bad = SimpleUploadedFile("malware.exe", b"MZ", content_type="application/octet-stream")
    resp = client.post(
        "/api/v1/expenses",
        {"amount": 1000, "date": "2026-06-01", "receipt_image": bad},
        format="multipart",
    )
    assert resp.status_code == 400


def test_cashier_cannot_access_expenses(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    cashier = make_user("cashier@shopm.local")
    shop = make_shop(owner, name="S", cashier=cashier)
    client = auth(cashier, shop=shop)
    assert client.get("/api/v1/expenses").status_code == 403
