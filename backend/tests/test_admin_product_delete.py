"""Deleting a product in Django admin must not trip over the append-only ledger.

Regression: InventoryTransaction.product is PROTECT and its admin hard-codes
has_delete_permission() -> False, so the delete-confirmation collector pushed
"inventory transaction" into `perms_needed` and even a superuser was told they
lacked permission. Product soft-deletes, so nothing cascades in the first place.
"""

import pytest
from django.urls import reverse

from apps.accounts.models import User
from apps.catalog.models import Product
from apps.inventory.models import InventoryTransaction


@pytest.fixture
def superuser(db):
    return User.objects.create_superuser(
        email="root@example.com", password="password123", full_name="Root"
    )


@pytest.fixture
def product_with_ledger(db, make_user, make_shop):
    owner = make_user("owner@example.com")
    shop = make_shop(owner)
    product = Product.objects.create(shop=shop, name="Sugar", sku="SKU-1", stock_cached=5)
    InventoryTransaction.objects.create(
        shop=shop, product=product, quantity=5, type="adjustment", user=owner
    )
    return product


@pytest.fixture
def admin_client(client, superuser):
    client.force_login(superuser)
    return client


def test_confirmation_page_has_no_permission_error(admin_client, product_with_ledger):
    url = reverse("admin:catalog_product_delete", args=[product_with_ledger.pk])
    resp = admin_client.get(url)

    assert resp.status_code == 200
    assert not resp.context["perms_lacking"]
    assert not resp.context["protected"]
    assert "Cannot delete" not in resp.context["title"]


def test_single_delete_soft_deletes_and_keeps_ledger(admin_client, product_with_ledger):
    url = reverse("admin:catalog_product_delete", args=[product_with_ledger.pk])
    resp = admin_client.post(url, {"post": "yes"})

    assert resp.status_code == 302
    product_with_ledger.refresh_from_db()
    assert product_with_ledger.deleted_at is not None
    assert not Product.objects.filter(pk=product_with_ledger.pk).exists()
    assert InventoryTransaction.objects.filter(product=product_with_ledger).count() == 1


def test_bulk_delete_action_soft_deletes(admin_client, product_with_ledger):
    url = reverse("admin:catalog_product_changelist")
    resp = admin_client.post(
        url,
        {
            "action": "delete_selected",
            "_selected_action": [str(product_with_ledger.pk)],
            "post": "yes",
        },
    )

    assert resp.status_code == 302
    product_with_ledger.refresh_from_db()
    assert product_with_ledger.deleted_at is not None
    assert InventoryTransaction.objects.filter(product=product_with_ledger).count() == 1


def test_changelist_shows_soft_deleted_products(admin_client, product_with_ledger):
    product_with_ledger.delete()

    resp = admin_client.get(reverse("admin:catalog_product_changelist"))

    assert resp.status_code == 200
    assert product_with_ledger.pk in {o.pk for o in resp.context["cl"].result_list}


def test_restore_action_brings_product_back(admin_client, product_with_ledger):
    product_with_ledger.delete()

    admin_client.post(
        reverse("admin:catalog_product_changelist"),
        {"action": "restore", "_selected_action": [str(product_with_ledger.pk)]},
    )

    product_with_ledger.refresh_from_db()
    assert product_with_ledger.deleted_at is None
    assert Product.objects.filter(pk=product_with_ledger.pk).exists()
