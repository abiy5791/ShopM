"""Correcting a mis-recorded sale (apps.sales.amend).

Editing a sale rewrites money that has already been reported on, so the tests
here are as much about what an edit *cannot* do — and what it always leaves
behind — as about the correction itself.
"""

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.activity.models import ActivityLog
from apps.catalog.models import Product
from apps.customers.models import Customer
from apps.inventory.services import record_transaction
from apps.sales.models import Sale, SaleAmendment

pytestmark = pytest.mark.django_db


@pytest.fixture
def ctx(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    cashier = make_user("cashier@shopm.local")
    shop = make_shop(owner, name="S", cashier=cashier)
    widget = Product.objects.create(
        shop=shop, sku="SKU-1", name="Widget", selling_price=1000, purchase_price=600
    )
    gadget = Product.objects.create(
        shop=shop, sku="SKU-2", name="Gadget", selling_price=2000, purchase_price=1200
    )
    record_transaction(product=widget, quantity=100, type="adjustment")
    record_transaction(product=gadget, quantity=100, type="adjustment")
    customer = Customer.objects.create(shop=shop, name="Abebe", phone="0900000000")
    return {
        "owner": owner,
        "cashier": cashier,
        "shop": shop,
        "widget": widget,
        "gadget": gadget,
        "customer": customer,
        "auth": auth,
    }


def sell(client, product, *, quantity=3, sale_date=None):
    body = {
        "client_uuid": str(uuid.uuid4()),
        "items": [{"product": str(product.id), "quantity": quantity}],
        "payments": [{"method": "cash", "amount": product.selling_price * quantity}],
    }
    if sale_date is not None:
        body["sale_date"] = str(sale_date)
    resp = client.post("/api/v1/sales", body, format="json")
    assert resp.status_code == 201, resp.data
    return resp.data


def edit(client, sale_id, **body):
    body.setdefault("reason", "Miscounted at the counter")
    return client.patch(f"/api/v1/sales/{sale_id}", body, format="json")


# ------------------------------------------------------------------ the point
def test_owner_corrects_a_quantity_and_stock_follows(ctx):
    """Rang up 3, sold 2: the sale, the money and the shelf all agree after."""
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=3)
    ctx["widget"].refresh_from_db()
    assert ctx["widget"].stock_cached == 97

    resp = edit(
        client,
        sale["id"],
        items=[{"product": str(ctx["widget"].id), "quantity": 2}],
        payments=[{"method": "cash", "amount": 2000}],
    )
    assert resp.status_code == 200, resp.data
    assert resp.data["total"] == 2000
    assert resp.data["subtotal"] == 2000
    assert resp.data["amount_paid"] == 2000
    assert resp.data["is_amended"] is True

    # Only the one over-sold unit went back on the shelf.
    ctx["widget"].refresh_from_db()
    assert ctx["widget"].stock_cached == 98


def test_correction_moves_the_reported_day(ctx):
    """A sale booked to the wrong day is moved, and both days re-report."""
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=2)  # today
    missed = timezone.localdate() - timedelta(days=2)

    assert edit(client, sale["id"], sale_date=str(missed)).status_code == 200

    today = client.get("/api/v1/reports/day").data
    moved = client.get("/api/v1/reports/day", {"date": str(missed)}).data
    assert today["summary"]["sales_total"] == 0
    assert moved["summary"]["sales_total"] == 2000
    # The money followed the sale, so the day still reconciles.
    assert moved["summary"]["cash_received"] == 2000


def test_correcting_the_payment_method(ctx):
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=2)

    resp = edit(
        client,
        sale["id"],
        reason="Paid by Telebirr, not cash",
        payments=[{"method": "telebirr", "amount": 2000}],
    )
    assert resp.status_code == 200
    assert [p["method"] for p in resp.data["payments"]] == ["telebirr"]

    day = client.get("/api/v1/reports/day").data
    assert day["by_method"] == [{"method": "telebirr", "total": 2000}]


def test_swapping_the_product_moves_both_stocks(ctx):
    """The wrong item was rung up: one product goes back, the other comes off."""
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=2)

    resp = edit(
        client,
        sale["id"],
        reason="Wrong product scanned",
        items=[{"product": str(ctx["gadget"].id), "quantity": 2}],
        payments=[{"method": "cash", "amount": 4000}],
    )
    assert resp.status_code == 200
    assert resp.data["total"] == 4000

    ctx["widget"].refresh_from_db()
    ctx["gadget"].refresh_from_db()
    assert ctx["widget"].stock_cached == 100  # fully returned
    assert ctx["gadget"].stock_cached == 98


def test_metadata_only_edit_touches_no_stock(ctx):
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=2)
    ctx["widget"].refresh_from_db()
    before = ctx["widget"].stock_cached

    assert edit(client, sale["id"], notes="Regular").status_code == 200
    ctx["widget"].refresh_from_db()
    assert ctx["widget"].stock_cached == before


def test_attaching_a_customer_turns_a_shortfall_into_credit(ctx):
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=2)  # 2000, paid in full

    resp = edit(
        client,
        sale["id"],
        reason="Customer paid half, rest on credit",
        customer=str(ctx["customer"].id),
        payments=[{"method": "cash", "amount": 1000}],
    )
    assert resp.status_code == 200
    ctx["customer"].refresh_from_db()
    assert ctx["customer"].credit_balance_cached == 1000


# ------------------------------------------------------------------ guardrails
def test_cashier_cannot_edit_a_sale(ctx):
    client = ctx["auth"](ctx["cashier"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=2)
    resp = edit(client, sale["id"], discount=500)
    assert resp.status_code == 403
    assert Sale.objects.get(id=sale["id"]).discount == 0


def test_a_reason_is_required(ctx):
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=2)

    resp = client.patch(f"/api/v1/sales/{sale['id']}", {"discount": 500}, format="json")
    assert resp.status_code == 400
    assert "reason" in resp.data["fields"]

    blank = client.patch(
        f"/api/v1/sales/{sale['id']}", {"reason": "   ", "discount": 500}, format="json"
    )
    assert blank.status_code == 400


def test_a_voided_sale_cannot_be_edited(ctx):
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=2)
    assert client.post(f"/api/v1/sales/{sale['id']}/void").status_code == 200

    resp = edit(client, sale["id"], discount=100)
    assert resp.status_code == 400
    assert "voided" in resp.data["detail"].lower()


def test_edit_cannot_oversell(ctx):
    """Raising the quantity beyond what is on the shelf is refused, and nothing
    about the sale changes."""
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=2)

    resp = edit(
        client,
        sale["id"],
        items=[{"product": str(ctx["widget"].id), "quantity": 500}],
        payments=[{"method": "cash", "amount": 500000}],
    )
    assert resp.status_code == 400
    assert resp.data["code"] == "insufficient_stock"

    reloaded = Sale.objects.get(id=sale["id"])
    assert reloaded.total == 2000
    assert reloaded.items.count() == 1
    assert reloaded.items.first().quantity == 2
    ctx["widget"].refresh_from_db()
    assert ctx["widget"].stock_cached == 98


def test_shortfall_without_a_customer_is_refused(ctx):
    """The checkout rule holds on an edit too: underpayment needs a debtor."""
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=2)

    resp = edit(client, sale["id"], payments=[{"method": "cash", "amount": 500}])
    assert resp.status_code == 400
    assert "credit" in resp.data["detail"].lower()
    assert Sale.objects.get(id=sale["id"]).total == 2000


def test_edit_obeys_the_backdating_window(ctx):
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=2)

    future = edit(client, sale["id"], sale_date=str(timezone.localdate() + timedelta(days=1)))
    assert future.status_code == 400

    too_old = edit(client, sale["id"], sale_date=str(timezone.localdate() - timedelta(days=99)))
    assert too_old.status_code == 400


def test_a_failed_edit_leaves_no_amendment(ctx):
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=2)
    edit(client, sale["id"], payments=[{"method": "cash", "amount": 1}])
    assert SaleAmendment.objects.count() == 0
    assert Sale.objects.get(id=sale["id"]).amended_at is None


# ------------------------------------------------------------------ audit
def test_every_edit_is_recorded_with_a_readable_diff(ctx):
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=3)

    resp = edit(
        client,
        sale["id"],
        reason="Miscounted at the counter",
        items=[{"product": str(ctx["widget"].id), "quantity": 2}],
        payments=[{"method": "cash", "amount": 2000}],
    )
    amendments = resp.data["amendments"]
    assert len(amendments) == 1
    entry = amendments[0]
    assert entry["reason"] == "Miscounted at the counter"
    assert entry["user_email"] == ctx["owner"].email

    fields = {c["field"]: c for c in entry["changes"]}
    assert fields["Total"]["from"] == "30.00"
    assert fields["Total"]["to"] == "20.00"
    assert "3 × Widget" in fields["Items"]["from"]
    assert "2 × Widget" in fields["Items"]["to"]

    # The original figures stay readable forever.
    assert entry["before"]["total"] == 3000
    assert entry["before"]["items"][0]["quantity"] == 3
    assert entry["after"]["total"] == 2000


def test_edits_are_logged_at_warn_level(ctx):
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=2)
    edit(client, sale["id"], reason="Discount agreed after the fact", discount=200)

    log = ActivityLog.objects.get(action="sale.update")
    assert log.level == "warn"
    assert log.user == ctx["owner"]
    assert log.metadata["reason"] == "Discount agreed after the fact"
    assert any(c["field"] == "Discount" for c in log.metadata["changes"])


def test_amendments_accumulate_in_order(ctx):
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=3)
    edit(client, sale["id"], reason="First fix", discount=100)
    resp = edit(client, sale["id"], reason="Second fix", discount=200)

    reasons = [a["reason"] for a in resp.data["amendments"]]
    assert reasons == ["Second fix", "First fix"]  # newest first
    assert SaleAmendment.objects.count() == 2


def test_amendments_are_append_only(ctx):
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=2)
    edit(client, sale["id"], discount=100)

    amendment = SaleAmendment.objects.get()
    with pytest.raises(ValueError):
        amendment.save()
    with pytest.raises(ValueError):
        amendment.delete()


def test_a_deactivated_product_can_stay_on_the_sale_it_was_sold_on(ctx):
    """Correcting an old sale must not force dropping a discontinued line."""
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sale = sell(client, ctx["widget"], quantity=3)
    Product.objects.filter(pk=ctx["widget"].pk).update(status=Product.Status.INACTIVE)

    resp = edit(
        client,
        sale["id"],
        items=[{"product": str(ctx["widget"].id), "quantity": 2}],
        payments=[{"method": "cash", "amount": 2000}],
    )
    assert resp.status_code == 200, resp.data
    assert resp.data["total"] == 2000

    # But it still cannot be added to a sale it was never on.
    other = sell(client, ctx["gadget"], quantity=1)
    blocked = edit(
        client,
        other["id"],
        items=[{"product": str(ctx["widget"].id), "quantity": 1}],
        payments=[{"method": "cash", "amount": 1000}],
    )
    assert blocked.status_code == 400
