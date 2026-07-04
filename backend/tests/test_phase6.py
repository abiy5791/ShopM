"""Phase 6 DoD assertions (plan §11 Phase 6): owner multi-shop console."""

import uuid

import pytest
from django.core import mail

from apps.catalog.models import Product
from apps.inventory.services import record_transaction
from apps.owner.tasks import send_daily_summaries
from apps.sales.services import create_sale

pytestmark = pytest.mark.django_db


def _sell(shop, cashier, *, price, qty, sku="SKU-1"):
    product = Product.objects.create(
        shop=shop, sku=sku, name=f"Widget {sku}", selling_price=price, purchase_price=price // 2
    )
    record_transaction(product=product, quantity=100, type="adjustment")
    create_sale(
        shop=shop,
        cashier=cashier,
        client_uuid=str(uuid.uuid4()),
        items=[{"product": product, "quantity": qty}],
        payments=[{"method": "cash", "amount": price * qty}],
    )


# --- DoD: owner sees correct aggregates spanning ≥2 shops ---
def test_owner_dashboard_spans_two_shops(make_user, make_shop, auth):
    owner = make_user("o@shopm.local")
    shop_a = make_shop(owner, name="Alpha")
    shop_b = make_shop(owner, name="Beta")
    _sell(shop_a, owner, price=1000, qty=2)  # 2000
    _sell(shop_b, owner, price=500, qty=3)  # 1500

    client = auth(owner)  # no X-Shop-Id — owner-wide
    resp = client.get("/api/v1/owner/dashboard")
    assert resp.status_code == 200
    assert resp.data["shop_count"] == 2
    by_name = {s["shop_name"]: s for s in resp.data["shops"]}
    assert by_name["Alpha"]["today"]["sales_total"] == 2000
    assert by_name["Beta"]["today"]["sales_total"] == 1500


# --- DoD: comparison ranks shops by sales for a chosen period ---
def test_compare_ranks_by_sales(make_user, make_shop, auth):
    owner = make_user("o@shopm.local")
    shop_a = make_shop(owner, name="Alpha")
    shop_b = make_shop(owner, name="Beta")
    _sell(shop_a, owner, price=1000, qty=1)  # 1000
    _sell(shop_b, owner, price=1000, qty=5)  # 5000 — should rank first

    client = auth(owner)
    resp = client.get("/api/v1/owner/shops/compare")
    assert resp.status_code == 200
    shops = resp.data["shops"]
    assert [s["shop_name"] for s in shops] == ["Beta", "Alpha"]
    assert shops[0]["rank"] == 1 and shops[1]["rank"] == 2
    assert shops[0]["sales_total"] == 5000
    assert shops[0]["net_profit"] == 2500  # 5000 revenue − 2500 COGS, no expenses


# --- DoD: a cashier hitting any /owner/ route gets 403 ---
def test_cashier_denied_owner_routes(make_user, make_shop, auth):
    owner = make_user("o@shopm.local")
    cashier = make_user("c@shopm.local")
    make_shop(owner, name="S", cashier=cashier)
    client = auth(cashier)
    for path in (
        "/api/v1/owner/dashboard",
        "/api/v1/owner/shops/compare",
        "/api/v1/owner/activity",
    ):
        assert client.get(path).status_code == 403, path


def test_owner_activity_spans_shops(make_user, make_shop, auth):
    from apps.activity.services import log_activity

    owner = make_user("o@shopm.local")
    cashier = make_user("c@shopm.local")
    shop_a = make_shop(owner, name="Alpha")
    shop_b = make_shop(owner, name="Beta", cashier=cashier)
    log_activity(user=owner, action="sale.create", shop=shop_a, entity_type="sale")
    log_activity(user=cashier, action="sale.create", shop=shop_b, entity_type="sale")

    client = auth(owner)
    resp = client.get("/api/v1/owner/activity")
    assert resp.status_code == 200
    # Activity from both shops (including the cashier's) is visible in one feed.
    assert resp.data["count"] == 2
    emails = {row["user_email"] for row in resp.data["results"]}
    assert emails == {"o@shopm.local", "c@shopm.local"}


def test_owner_dashboard_excludes_other_owners_shops(make_user, make_shop, auth):
    owner_a = make_user("a@shopm.local")
    owner_b = make_user("b@shopm.local")
    make_shop(owner_a, name="Mine")
    make_shop(owner_b, name="Theirs")
    client = auth(owner_a)
    resp = client.get("/api/v1/owner/dashboard")
    assert resp.status_code == 200
    names = [s["shop_name"] for s in resp.data["shops"]]
    assert names == ["Mine"]


# --- DoD: daily summary task emails the owner ---
def test_daily_summary_sends_email(make_user, make_shop, settings):
    settings.OWNER_DAILY_SUMMARY_ENABLED = True
    owner = make_user("o@shopm.local")
    make_shop(owner, name="Alpha")
    make_shop(owner, name="Beta")

    sent = send_daily_summaries()
    assert sent == 1
    assert len(mail.outbox) == 1
    message = mail.outbox[0]
    assert message.to == ["o@shopm.local"]
    assert "Alpha" in message.body and "Beta" in message.body


def test_daily_summary_disabled_by_flag(make_user, make_shop, settings):
    settings.OWNER_DAILY_SUMMARY_ENABLED = False
    owner = make_user("o@shopm.local")
    make_shop(owner, name="Alpha")
    assert send_daily_summaries() == 0
    assert len(mail.outbox) == 0
