"""Recording a sale for an earlier day (apps.sales.backdating).

A day's takings sometimes never get rung up. The owner can enter those sales
later against the day they actually happened, so the missed day stops being
empty and the day they were typed in stops being inflated. The rules under test
here are the guardrails around that: owner-only, past-only, bounded, logged.
"""

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.activity.models import ActivityLog
from apps.catalog.models import Product
from apps.inventory.models import InventoryTransaction
from apps.inventory.services import record_transaction
from apps.sales.backdating import MAX_BACKDATE_DAYS
from apps.sales.models import Sale

pytestmark = pytest.mark.django_db


@pytest.fixture
def ctx(make_user, make_shop, auth):
    """An owner, a cashier, and a product with 100 units on the shelf."""
    owner = make_user("owner@shopm.local")
    cashier = make_user("cashier@shopm.local")
    shop = make_shop(owner, name="S", cashier=cashier)
    product = Product.objects.create(
        shop=shop, sku="SKU-1", name="Widget", selling_price=1000, purchase_price=600
    )
    record_transaction(product=product, quantity=100, type="adjustment")
    return {"owner": owner, "cashier": cashier, "shop": shop, "product": product, "auth": auth}


def sell(client, product, *, quantity=1, sale_date=None):
    body = {
        "client_uuid": str(uuid.uuid4()),
        "items": [{"product": str(product.id), "quantity": quantity}],
        "payments": [{"method": "cash", "amount": 1000 * quantity}],
    }
    if sale_date is not None:
        body["sale_date"] = str(sale_date)
    return client.post("/api/v1/sales", body, format="json")


# ------------------------------------------------------------------ the point
def test_owner_books_a_sale_to_a_missed_day(ctx):
    """The forgotten day gets its sale; today's books are untouched."""
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    missed = timezone.localdate() - timedelta(days=1)

    sell(client, ctx["product"], quantity=3, sale_date=missed)  # the catch-up
    sell(client, ctx["product"], quantity=1)  # a normal sale today

    yesterday = client.get("/api/v1/reports/day", {"date": str(missed)}).data
    today = client.get("/api/v1/reports/day").data

    assert yesterday["summary"]["sales_total"] == 3000
    assert yesterday["summary"]["sales_count"] == 1
    # The money is on the day it came in, so the day reconciles.
    assert yesterday["summary"]["cash_received"] == 3000
    assert yesterday["by_method"] == [{"method": "cash", "total": 3000}]

    assert today["summary"]["sales_total"] == 1000
    assert today["summary"]["sales_count"] == 1


def test_backdated_sale_keeps_both_dates(ctx):
    """occurred_at moves; created_at records when it was really entered."""
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    missed = timezone.localdate() - timedelta(days=2)

    resp = sell(client, ctx["product"], sale_date=missed)
    assert resp.status_code == 201
    assert resp.data["is_backdated"] is True

    sale = Sale.objects.get(id=resp.data["id"])
    assert timezone.localdate(sale.occurred_at) == missed
    assert timezone.localdate(sale.created_at) == timezone.localdate()
    assert timezone.localdate(sale.payments.first().received_at) == missed


def test_today_is_not_a_backdate(ctx):
    """Sending today's date explicitly is allowed and flags nothing."""
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    resp = sell(client, ctx["product"], sale_date=timezone.localdate())
    assert resp.status_code == 201
    assert resp.data["is_backdated"] is False


def test_omitting_the_date_books_the_sale_to_now(ctx):
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    resp = sell(client, ctx["product"])
    sale = Sale.objects.get(id=resp.data["id"])
    assert timezone.localdate(sale.occurred_at) == timezone.localdate()
    assert sale.is_backdated is False


# ------------------------------------------------------------------ guardrails
def test_cashier_cannot_backdate(ctx):
    """A cashier gets a 403, not a silently-ignored field — and no sale."""
    client = ctx["auth"](ctx["cashier"], shop=ctx["shop"])
    resp = sell(client, ctx["product"], sale_date=timezone.localdate() - timedelta(days=1))
    assert resp.status_code == 403
    assert Sale.objects.count() == 0


def test_cashier_can_still_sell_normally(ctx):
    client = ctx["auth"](ctx["cashier"], shop=ctx["shop"])
    assert sell(client, ctx["product"]).status_code == 201


def test_future_dates_are_rejected(ctx):
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    resp = sell(client, ctx["product"], sale_date=timezone.localdate() + timedelta(days=1))
    assert resp.status_code == 400
    assert resp.data["code"] == "validation_error"
    assert "future" in str(resp.data["fields"]["sale_date"][0]).lower()
    assert Sale.objects.count() == 0


def test_beyond_the_window_is_rejected(ctx):
    """Closed books stay closed — past the limit the answer is no."""
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    too_old = timezone.localdate() - timedelta(days=MAX_BACKDATE_DAYS + 1)
    resp = sell(client, ctx["product"], sale_date=too_old)
    assert resp.status_code == 400
    assert str(MAX_BACKDATE_DAYS) in str(resp.data["fields"]["sale_date"][0])
    assert Sale.objects.count() == 0

    # The oldest day still inside the window is fine.
    edge = timezone.localdate() - timedelta(days=MAX_BACKDATE_DAYS)
    assert sell(client, ctx["product"], sale_date=edge).status_code == 201


def test_backdating_is_logged_at_warn_level(ctx):
    """The audit trail is the safeguard: who moved a sale, and to when."""
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    missed = timezone.localdate() - timedelta(days=3)
    sell(client, ctx["product"], sale_date=missed)

    log = ActivityLog.objects.get(action="sale.create")
    assert log.level == "warn"
    assert log.user == ctx["owner"]
    assert log.metadata["backdated"] is True
    assert log.metadata["sale_date"] == str(missed)


def test_normal_sale_logs_at_info_level(ctx):
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sell(client, ctx["product"])
    log = ActivityLog.objects.get(action="sale.create")
    assert log.level == "info"
    assert log.metadata["backdated"] is False


def test_date_window_endpoint_reports_the_policy(ctx):
    owner_client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    data = owner_client.get("/api/v1/sales/date-window").data
    assert data["max_days"] == MAX_BACKDATE_DAYS
    assert data["latest"] == str(timezone.localdate())
    assert data["earliest"] == str(timezone.localdate() - timedelta(days=MAX_BACKDATE_DAYS))
    assert data["allowed"] is True

    cashier_client = ctx["auth"](ctx["cashier"], shop=ctx["shop"])
    assert cashier_client.get("/api/v1/sales/date-window").data["allowed"] is False


# ------------------------------------------------------------------ stock
def test_stock_moves_now_not_on_the_backdated_day(ctx):
    """The goods leave the ledger when the system learns they are gone; the
    ledger row says which day the sale belongs to."""
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    missed = timezone.localdate() - timedelta(days=1)
    sell(client, ctx["product"], quantity=4, sale_date=missed)

    ctx["product"].refresh_from_db()
    assert ctx["product"].stock_cached == 96

    txn = InventoryTransaction.objects.get(type="sale")
    assert txn.quantity == -4
    assert timezone.localdate(txn.created_at) == timezone.localdate()
    assert txn.notes == f"Sale backdated to {missed.isoformat()}"


def test_backdated_sale_cannot_exceed_current_stock(ctx):
    """Backdating is not a way around the stock floor."""
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    resp = sell(
        client,
        ctx["product"],
        quantity=101,
        sale_date=timezone.localdate() - timedelta(days=1),
    )
    assert resp.status_code == 400
    assert resp.data["code"] == "insufficient_stock"
    assert Sale.objects.count() == 0


# ------------------------------------------------------------------ reporting
def test_kpis_and_reports_follow_the_business_date(ctx):
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    missed = timezone.localdate() - timedelta(days=1)
    sell(client, ctx["product"], quantity=5, sale_date=missed)
    sell(client, ctx["product"], quantity=2)

    # "Sales today" counts only today's sale; yesterday feeds the comparison.
    cards = {c["key"]: c for c in client.get("/api/v1/sales/summary").data["cards"]}
    assert cards["today"]["value"] == 2000

    # The daily sales report puts each on its own day.
    report = client.get(
        "/api/v1/reports/sales",
        {"period": "daily", "start": str(missed), "end": str(timezone.localdate())},
    ).data
    by_day = {row["date"]: row["total"] for row in report["series"]}
    assert by_day[str(missed)] == 5000
    assert by_day[str(timezone.localdate())] == 2000


def test_sales_list_is_ordered_by_business_date(ctx):
    """The catch-up sale sorts under the day it belongs to, not the top."""
    client = ctx["auth"](ctx["owner"], shop=ctx["shop"])
    sell(client, ctx["product"], sale_date=timezone.localdate() - timedelta(days=1))
    sell(client, ctx["product"])

    rows = client.get("/api/v1/sales").data["results"]
    assert [r["is_backdated"] for r in rows] == [False, True]
