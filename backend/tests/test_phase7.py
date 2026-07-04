"""Phase 7 DoD assertions (plan §11 Phase 7): notifications, settings, backup."""

import os
import sqlite3
import uuid

import pytest

from apps.catalog.models import Product
from apps.expenses.models import Expense, ExpenseCategory
from apps.inventory.services import record_transaction
from apps.notifications.models import Notification
from apps.sales.services import create_sale, void_sale

pytestmark = pytest.mark.django_db


def _product(shop, *, stock, min_alert=5, price=100000, sku="SKU-1"):
    p = Product.objects.create(
        shop=shop, sku=sku, name="Widget", selling_price=price, min_stock_alert=min_alert
    )
    if stock:
        record_transaction(product=p, quantity=stock, type="adjustment")
    p.refresh_from_db()
    return p


# --- DoD: low-stock notification fires on the right condition and is dismissible ---
def test_low_stock_notification_fires_and_is_dismissible(make_user, make_shop, auth):
    owner = make_user("o@shopm.local")
    shop = make_shop(owner, name="S")
    product = _product(shop, stock=6, min_alert=5, price=100)

    create_sale(
        shop=shop,
        cashier=owner,
        client_uuid=str(uuid.uuid4()),
        items=[{"product": product, "quantity": 2}],  # 6 → 4, below alert of 5
        payments=[{"method": "cash", "amount": 200}],
    )
    note = Notification.objects.filter(shop=shop, type="low_stock").first()
    assert note is not None and note.read_at is None

    client = auth(owner, shop=shop)
    listed = client.get("/api/v1/notifications")
    assert listed.status_code == 200
    assert listed.data["count"] >= 1

    read = client.post(f"/api/v1/notifications/{note.id}/read")
    assert read.status_code == 200
    assert read.data["is_read"] is True


def test_low_stock_deduped_until_read(make_user, make_shop):
    owner = make_user("o@shopm.local")
    shop = make_shop(owner, name="S")
    product = _product(shop, stock=10, min_alert=5, price=100)
    for _ in range(3):
        create_sale(
            shop=shop,
            cashier=owner,
            client_uuid=str(uuid.uuid4()),
            items=[{"product": product, "quantity": 2}],
            payments=[{"method": "cash", "amount": 200}],
        )
    # Multiple low-stock sales, but only one unread notification.
    assert Notification.objects.filter(shop=shop, type="low_stock").count() == 1


def test_large_expense_and_void_notifications(make_user, make_shop, settings):
    settings.LARGE_EXPENSE_THRESHOLD = 10000
    settings.LARGE_VOID_THRESHOLD = 10000
    owner = make_user("o@shopm.local")
    shop = make_shop(owner, name="S")
    cat = ExpenseCategory.objects.create(shop=shop, name="Rent")
    from django.utils import timezone

    Expense.objects.create(
        shop=shop, category=cat, amount=50000, date=timezone.now().date(), user=owner
    )
    # Trigger is wired to the viewset; call the service directly for a unit check.
    from apps.notifications.services import notify_large_expense

    notify_large_expense(Expense.objects.get())
    assert Notification.objects.filter(shop=shop, type="large_expense").exists()

    product = _product(shop, stock=100, price=100000, sku="V-1")
    sale, _ = create_sale(
        shop=shop,
        cashier=owner,
        client_uuid=str(uuid.uuid4()),
        items=[{"product": product, "quantity": 1}],  # total 100000 > 10000
        payments=[{"method": "cash", "amount": 100000}],
    )
    void_sale(sale, user=owner)
    assert Notification.objects.filter(shop=shop, type="large_void").exists()


# --- DoD: failed logins are logged and (after a threshold) notify the owner ---
def test_failed_logins_notify_after_threshold(api, make_user, make_shop, settings):
    settings.FAILED_LOGIN_THRESHOLD = 3
    owner = make_user("o@shopm.local")
    make_shop(owner, name="S")
    for _ in range(3):
        resp = api.post(
            "/api/v1/auth/login",
            {"email": "o@shopm.local", "password": "wrong"},
            format="json",
        )
        assert resp.status_code == 401
    assert Notification.objects.filter(type="failed_login").exists()


# --- DoD: settings changes take effect and are logged ---
def test_settings_update_takes_effect_and_is_logged(make_user, make_shop, auth):
    from apps.activity.models import ActivityLog

    owner = make_user("o@shopm.local")
    shop = make_shop(owner, name="S")
    client = auth(owner, shop=shop)
    resp = client.patch(
        "/api/v1/settings", {"tax_rate": "15.00", "receipt_footer": "Thanks!"}, format="json"
    )
    assert resp.status_code == 200
    assert resp.data["tax_rate"] == "15.00"
    assert resp.data["receipt_footer"] == "Thanks!"
    shop.settings.refresh_from_db()
    assert str(shop.settings.tax_rate) == "15.00"
    assert ActivityLog.objects.filter(action="settings.update", shop=shop).exists()


# --- DoD: activity log viewer filters (date range) ---
def test_activity_date_filter(make_user, make_shop, auth):
    owner = make_user("o@shopm.local")
    shop = make_shop(owner, name="S")
    client = auth(owner, shop=shop)
    # A far-future lower bound returns nothing.
    resp = client.get("/api/v1/activity?created_after=2999-01-01T00:00:00Z")
    assert resp.status_code == 200
    assert resp.data["count"] == 0


# --- DoD: a backup can be produced and restored into a clean DB ---
def test_backup_and_restore_roundtrip(tmp_path, settings):
    # Point the "database" at a real sqlite file so backup can copy it.
    db_file = tmp_path / "app.sqlite3"
    conn = sqlite3.connect(db_file)
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
    conn.execute("INSERT INTO t (v) VALUES ('original')")
    conn.commit()
    conn.close()

    settings.DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": str(db_file)}}
    settings.BACKUP_DIR = str(tmp_path / "backups")

    from apps.common.backup import create_backup, restore_sqlite

    backup_path = create_backup()
    assert os.path.exists(backup_path) and os.path.getsize(backup_path) > 0

    # Corrupt the live DB, then restore from the backup.
    conn = sqlite3.connect(db_file)
    conn.execute("UPDATE t SET v = 'corrupted'")
    conn.commit()
    conn.close()

    restore_sqlite(backup_path)

    conn = sqlite3.connect(db_file)
    value = conn.execute("SELECT v FROM t").fetchone()[0]
    conn.close()
    assert value == "original"  # restored into a clean state
