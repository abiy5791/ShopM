"""Money reads as money in the Django admin (apps.common.admin).

Money is stored as integer minor units — Br700.00 is the integer 70000 — so the
admin used to render "70000" for a price and "175000" for a sale total. The
stored figures were always right; the admin was just missing the formatting step
the frontend already does at its display edge.

The other half matters just as much: an admin form that *shows* 700.00 must also
*save* 700.00. Showing major units while accepting minor ones would turn a
correction of a price to 750.00 into Br7.50.

And none of it may touch the API, which keeps speaking integer minor units.
"""

import uuid
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.models import User
from apps.catalog.models import Product
from apps.common.money import MoneyFormField, format_money
from apps.customers.models import Customer
from apps.inventory.services import record_transaction
from apps.shops.models import ShopSettings

pytestmark = pytest.mark.django_db


@pytest.fixture
def superuser(db):
    return User.objects.create_superuser(
        email="root@example.com", password="password123", full_name="Root"
    )


@pytest.fixture
def admin_client(client, superuser):
    client.force_login(superuser)
    return client


@pytest.fixture
def shop_ctx(make_user, make_shop):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="Fenet Boutique")
    # The conftest shop is created with USD; this app's shops run on ETB.
    ShopSettings.objects.filter(shop=shop).update(currency="ETB")
    product = Product.objects.create(
        shop=shop,
        sku="KID-003",
        name="Kids Denim Jacket",
        selling_price=70000,  # Br700.00
        purchase_price=40000,  # Br400.00
    )
    record_transaction(product=product, quantity=10, type="adjustment")
    return {"owner": owner, "shop": shop, "product": product}


# ------------------------------------------------------------------ display
def test_product_list_shows_prices_as_money(admin_client, shop_ctx):
    """The exact case reported: 70000 in the list should read Br700.00."""
    resp = admin_client.get(reverse("admin:catalog_product_changelist"))
    body = resp.content.decode()

    assert resp.status_code == 200
    assert "Br700.00" in body
    assert "Br400.00" in body
    # The bare integer must not be what a human reads.
    assert ">70000<" not in body


def test_sale_and_its_lines_show_as_money(admin_client, shop_ctx, auth):
    client = auth(shop_ctx["owner"], shop=shop_ctx["shop"])
    resp = client.post(
        "/api/v1/sales",
        {
            "client_uuid": str(uuid.uuid4()),
            "items": [{"product": str(shop_ctx["product"].id), "quantity": 2}],
            "payments": [{"method": "cash", "amount": 140000}],
        },
        format="json",
    )
    assert resp.status_code == 201
    sale_id = resp.data["id"]

    listing = admin_client.get(reverse("admin:sales_sale_changelist")).content.decode()
    assert "Br1,400.00" in listing  # 140000 minor units

    detail = admin_client.get(reverse("admin:sales_sale_change", args=[sale_id])).content.decode()
    assert "Br700.00" in detail  # unit price on the line
    assert "Br1,400.00" in detail  # line total and payment


def test_the_read_only_sale_form_formats_its_own_totals(admin_client, shop_ctx, auth):
    """A Sale is never editable in admin, so Django renders the whole form
    read-only and the money *form field* never applies. Its own subtotal,
    discount, tax and total need formatted stand-ins or they show raw."""
    client = auth(shop_ctx["owner"], shop=shop_ctx["shop"])
    sale_id = client.post(
        "/api/v1/sales",
        {
            "client_uuid": str(uuid.uuid4()),
            "items": [{"product": str(shop_ctx["product"].id), "quantity": 2}],
            "payments": [{"method": "cash", "amount": 139000}],
            "discount": 1000,
        },
        format="json",
    ).data["id"]

    body = admin_client.get(reverse("admin:sales_sale_change", args=[sale_id])).content.decode()

    assert "Br1,400.00" in body  # subtotal
    assert "Br10.00" in body  # discount
    assert "Br1,390.00" in body  # total
    # The raw integers must not be what a human reads.
    assert ">140000<" not in body
    assert ">139000<" not in body


def test_payment_and_purchase_labels_read_as_money(shop_ctx, auth):
    """Inline row headers come from __str__, which showed "cash 175000"."""
    from apps.sales.models import Payment

    client = auth(shop_ctx["owner"], shop=shop_ctx["shop"])
    client.post(
        "/api/v1/sales",
        {
            "client_uuid": str(uuid.uuid4()),
            "items": [{"product": str(shop_ctx["product"].id), "quantity": 1}],
            "payments": [{"method": "cash", "amount": 70000}],
        },
        format="json",
    )
    assert str(Payment.objects.get()) == "cash Br700.00"


def test_a_label_never_raises_when_the_shop_is_unreachable():
    """__str__ must not be able to take out an admin page or an error message."""
    from apps.sales.models import Payment

    assert "0.00" in str(Payment(method="cash", amount=0))


def test_zero_decimal_currencies_are_not_given_decimals(admin_client, shop_ctx):
    """A shop on a zero-decimal currency has no minor unit to show."""
    ShopSettings.objects.filter(shop=shop_ctx["shop"]).update(currency="UGX")
    body = admin_client.get(reverse("admin:catalog_product_changelist")).content.decode()

    assert "70,000 UGX" in body
    assert "Br700.00" not in body


def test_a_row_without_shop_settings_still_renders(admin_client, shop_ctx):
    """Falls back to the site default rather than raising on a missing row."""
    ShopSettings.objects.filter(shop=shop_ctx["shop"]).delete()
    resp = admin_client.get(reverse("admin:catalog_product_changelist"))

    assert resp.status_code == 200
    assert format_money(70000, "ETB") in resp.content.decode()


def test_customer_balance_reads_as_money(admin_client, shop_ctx):
    Customer.objects.create(
        shop=shop_ctx["shop"], name="Abebe", phone="0900", credit_balance_cached=125050
    )
    body = admin_client.get(reverse("admin:customers_customer_changelist")).content.decode()
    assert "Br1,250.50" in body


# ------------------------------------------------------------------ editing
def test_the_edit_form_shows_and_saves_major_units(admin_client, shop_ctx):
    """Read 700.00, type 750.50, store 75050 — not 750."""
    product = shop_ctx["product"]
    url = reverse("admin:catalog_product_change", args=[product.pk])

    form_html = admin_client.get(url).content.decode()
    assert 'value="700.00"' in form_html

    resp = admin_client.post(
        url,
        {
            "shop": str(product.shop_id),
            "name": product.name,
            "sku": product.sku,
            "barcode": "",
            "purchase_price": "400.00",
            "selling_price": "750.50",
            "unit": "pcs",
            "min_stock_alert": "0",
            "status": "active",
            "stock_cached": str(product.stock_cached),
        },
    )
    assert resp.status_code == 302, resp.content[:2000]

    product.refresh_from_db()
    assert product.selling_price == 75050
    assert product.purchase_price == 40000


def test_the_form_field_round_trips(shop_ctx):
    field = MoneyFormField()
    field.set_currency("ETB")

    assert field.prepare_value(70000) == Decimal("700.00")
    assert field.clean("700.00") == 70000
    assert field.clean("0.05") == 5
    # A re-displayed value after a validation error must not be divided twice.
    assert field.prepare_value("750.50") == "750.50"

    field.set_currency("UGX")  # zero-decimal
    assert field.clean("70000") == 70000
    assert field.prepare_value(70000) == Decimal("70000")


# ------------------------------------------------------------------ the API
def test_the_api_still_speaks_integer_minor_units(shop_ctx, auth):
    """The whole point of confining this to `formfield()`.

    DRF maps a model field to a serializer field by class and never calls
    `formfield()`, so nothing the admin does can leak into the API contract that
    the frontend depends on.
    """
    client = auth(shop_ctx["owner"], shop=shop_ctx["shop"])

    created = client.post(
        "/api/v1/products",
        {"name": "Kids T-Shirt", "sku": "KID-001", "selling_price": 30000, "purchase_price": 18000},
        format="json",
    )
    assert created.status_code == 201, created.data
    assert created.data["selling_price"] == 30000  # integer in, integer out
    assert Product.objects.get(sku="KID-001").selling_price == 30000

    listed = client.get("/api/v1/products", {"search": "KID-001"}).data["results"][0]
    assert listed["selling_price"] == 30000
    assert isinstance(listed["selling_price"], int)
