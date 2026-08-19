"""Adversarial checks on the sale endpoints added for backdating and corrections.

These probe the properties the features depend on rather than their happy paths:
tenant isolation, role enforcement, and the fact that a client can never state a
figure the server is supposed to derive.
"""

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.catalog.models import Product
from apps.customers.models import Customer
from apps.inventory.services import record_transaction
from apps.sales.models import Sale, SaleAmendment

pytestmark = pytest.mark.django_db


def _stocked(shop, sku="SKU-1", price=1000):
    product = Product.objects.create(
        shop=shop, sku=sku, name=f"Widget {sku}", selling_price=price, purchase_price=600
    )
    record_transaction(product=product, quantity=100, type="adjustment")
    return product


@pytest.fixture
def two_shops(make_user, make_shop, auth):
    """Two unrelated shops, each with its own owner, product and customer."""
    a_owner, b_owner = make_user("a@shopm.local"), make_user("b@shopm.local")
    cashier = make_user("cashier@shopm.local")
    shop_a = make_shop(a_owner, name="A", cashier=cashier)
    shop_b = make_shop(b_owner, name="B")
    return {
        "a": {
            "owner": a_owner,
            "shop": shop_a,
            "product": _stocked(shop_a, "A-1"),
            "customer": Customer.objects.create(shop=shop_a, name="Abebe"),
        },
        "b": {
            "owner": b_owner,
            "shop": shop_b,
            "product": _stocked(shop_b, "B-1"),
            "customer": Customer.objects.create(shop=shop_b, name="Bekele"),
        },
        "cashier": cashier,
        "auth": auth,
    }


def make_sale(client, product, quantity=2):
    resp = client.post(
        "/api/v1/sales",
        {
            "client_uuid": str(uuid.uuid4()),
            "items": [{"product": str(product.id), "quantity": quantity}],
            "payments": [{"method": "cash", "amount": product.selling_price * quantity}],
        },
        format="json",
    )
    assert resp.status_code == 201, resp.data
    return resp.data


# ------------------------------------------------------------------ tenancy
def test_an_owner_cannot_correct_another_shops_sale(two_shops):
    """A sale outside the active shop is a 404 — never "exists but forbidden"."""
    a, b = two_shops["a"], two_shops["b"]
    b_client = two_shops["auth"](b["owner"], shop=b["shop"])
    victim = make_sale(b_client, b["product"])

    a_client = two_shops["auth"](a["owner"], shop=a["shop"])
    resp = a_client.patch(
        f"/api/v1/sales/{victim['id']}", {"reason": "not mine", "discount": 100}, format="json"
    )

    assert resp.status_code == 404
    assert Sale.objects.get(id=victim["id"]).discount == 0
    assert SaleAmendment.objects.count() == 0


def test_pointing_the_shop_header_at_a_shop_you_are_not_in_is_a_404(two_shops):
    a, b = two_shops["a"], two_shops["b"]
    b_client = two_shops["auth"](b["owner"], shop=b["shop"])
    victim = make_sale(b_client, b["product"])

    # A's owner presents B's shop id; membership is what decides, not the header.
    intruder = two_shops["auth"](a["owner"], shop=b["shop"])
    assert intruder.get(f"/api/v1/sales/{victim['id']}").status_code == 404
    assert (
        intruder.patch(
            f"/api/v1/sales/{victim['id']}", {"reason": "x", "discount": 1}, format="json"
        ).status_code
        == 404
    )


def test_a_correction_cannot_pull_in_another_shops_product(two_shops):
    a, b = two_shops["a"], two_shops["b"]
    a_client = two_shops["auth"](a["owner"], shop=a["shop"])
    sale = make_sale(a_client, a["product"])

    resp = a_client.patch(
        f"/api/v1/sales/{sale['id']}",
        {
            "reason": "swap",
            "items": [{"product": str(b["product"].id), "quantity": 1}],
            "payments": [{"method": "cash", "amount": 1000}],
        },
        format="json",
    )

    assert resp.status_code == 400
    b["product"].refresh_from_db()
    assert b["product"].stock_cached == 100  # untouched


def test_a_correction_cannot_bill_another_shops_customer(two_shops):
    a, b = two_shops["a"], two_shops["b"]
    a_client = two_shops["auth"](a["owner"], shop=a["shop"])
    sale = make_sale(a_client, a["product"])

    resp = a_client.patch(
        f"/api/v1/sales/{sale['id']}",
        {"reason": "credit", "customer": str(b["customer"].id)},
        format="json",
    )

    assert resp.status_code == 400
    b["customer"].refresh_from_db()
    assert b["customer"].credit_balance_cached == 0


# ------------------------------------------------------------------ roles
def test_put_is_owner_only_too_not_just_patch(two_shops):
    """UpdateModelMixin exposes both verbs; both must be gated."""
    a = two_shops["a"]
    owner_client = two_shops["auth"](a["owner"], shop=a["shop"])
    sale = make_sale(owner_client, a["product"])

    cashier_client = two_shops["auth"](two_shops["cashier"], shop=a["shop"])
    resp = cashier_client.put(
        f"/api/v1/sales/{sale['id']}", {"reason": "nope", "discount": 500}, format="json"
    )

    assert resp.status_code == 403
    assert Sale.objects.get(id=sale["id"]).discount == 0


def test_a_cashier_is_told_they_may_not_backdate(two_shops):
    a = two_shops["a"]
    cashier_client = two_shops["auth"](two_shops["cashier"], shop=a["shop"])
    window = cashier_client.get("/api/v1/sales/date-window").data
    assert window["allowed"] is False


# ------------------------------------------------------- client-stated figures
def test_the_client_cannot_state_the_total(two_shops):
    """Totals are derived from the stored lines, never accepted from the wire."""
    a = two_shops["a"]
    client = two_shops["auth"](a["owner"], shop=a["shop"])
    sale = make_sale(client, a["product"], quantity=2)  # 2000

    resp = client.patch(
        f"/api/v1/sales/{sale['id']}",
        {
            "reason": "try to set the total",
            "total": 1,
            "subtotal": 1,
            "amount_paid": 999999,
        },
        format="json",
    )

    assert resp.status_code == 200
    reloaded = Sale.objects.get(id=sale["id"])
    assert reloaded.total == 2000
    assert reloaded.subtotal == 2000


def test_server_owned_fields_are_not_settable(two_shops):
    """shop, cashier, status and the audit stamps are not part of the contract."""
    a, b = two_shops["a"], two_shops["b"]
    client = two_shops["auth"](a["owner"], shop=a["shop"])
    sale = make_sale(client, a["product"])
    before = Sale.objects.get(id=sale["id"])

    resp = client.patch(
        f"/api/v1/sales/{sale['id']}",
        {
            "reason": "attempt",
            "shop": str(b["shop"].id),
            "cashier": str(b["owner"].id),
            "status": "voided",
            "client_uuid": str(uuid.uuid4()),
            "amended_by": str(b["owner"].id),
            "occurred_at": "2020-01-01T00:00:00Z",
            "created_at": "2020-01-01T00:00:00Z",
        },
        format="json",
    )

    assert resp.status_code == 200
    after = Sale.objects.get(id=sale["id"])
    assert after.shop_id == before.shop_id
    assert after.cashier_id == before.cashier_id
    assert after.status == Sale.Status.COMPLETED
    assert after.client_uuid == before.client_uuid
    assert after.created_at == before.created_at
    # `occurred_at` moves only through `sale_date`, which is range-checked.
    assert after.occurred_at == before.occurred_at
    assert after.amended_by_id == a["owner"].id


def test_negative_money_is_rejected(two_shops):
    a = two_shops["a"]
    client = two_shops["auth"](a["owner"], shop=a["shop"])
    sale = make_sale(client, a["product"])

    for payload in (
        {"reason": "neg discount", "discount": -100},
        {"reason": "neg tax", "tax": -100},
        {"reason": "neg qty", "items": [{"product": str(a["product"].id), "quantity": -1}]},
        {"reason": "neg pay", "payments": [{"method": "cash", "amount": -5}]},
    ):
        resp = client.patch(f"/api/v1/sales/{sale['id']}", payload, format="json")
        assert resp.status_code == 400, payload

    assert Sale.objects.get(id=sale["id"]).total == 2000


def test_a_discount_larger_than_the_sale_is_refused(two_shops):
    """The total may never go negative — that would be the shop paying out."""
    a = two_shops["a"]
    client = two_shops["auth"](a["owner"], shop=a["shop"])
    sale = make_sale(client, a["product"])  # 2000

    resp = client.patch(
        f"/api/v1/sales/{sale['id']}",
        {"reason": "huge discount", "discount": 999999},
        format="json",
    )

    assert resp.status_code == 400
    assert Sale.objects.get(id=sale["id"]).total == 2000


# ------------------------------------------------------------------ audit
def test_the_amendment_trail_is_not_writable_over_the_api(two_shops):
    a = two_shops["a"]
    client = two_shops["auth"](a["owner"], shop=a["shop"])
    sale = make_sale(client, a["product"])
    client.patch(f"/api/v1/sales/{sale['id']}", {"reason": "real", "discount": 100}, format="json")

    # A forged history sent alongside a later edit must be ignored outright.
    resp = client.patch(
        f"/api/v1/sales/{sale['id']}",
        {
            "reason": "second",
            "discount": 200,
            "amendments": [],
            "is_amended": False,
            "amended_at": None,
        },
        format="json",
    )

    assert resp.status_code == 200
    assert SaleAmendment.objects.filter(sale_id=sale["id"]).count() == 2
    assert [a["reason"] for a in resp.data["amendments"]] == ["second", "real"]


def test_backdating_beyond_the_window_is_refused_on_both_endpoints(two_shops):
    a = two_shops["a"]
    client = two_shops["auth"](a["owner"], shop=a["shop"])
    too_old = str(timezone.localdate() - timedelta(days=400))

    created = client.post(
        "/api/v1/sales",
        {
            "client_uuid": str(uuid.uuid4()),
            "items": [{"product": str(a["product"].id), "quantity": 1}],
            "payments": [{"method": "cash", "amount": 1000}],
            "sale_date": too_old,
        },
        format="json",
    )
    assert created.status_code == 400

    sale = make_sale(client, a["product"])
    edited = client.patch(
        f"/api/v1/sales/{sale['id']}", {"reason": "move it", "sale_date": too_old}, format="json"
    )
    assert edited.status_code == 400
