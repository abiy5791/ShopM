import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.shops.models import Shop, ShopMembership, ShopSettings


@pytest.fixture
def api():
    return APIClient()


@pytest.fixture
def roles(db):
    owner, _ = Role.objects.get_or_create(name=Role.Name.OWNER)
    cashier, _ = Role.objects.get_or_create(name=Role.Name.CASHIER)
    return {"owner": owner, "cashier": cashier}


@pytest.fixture
def make_user(db):
    def _make(email, full_name="Test User", password="password123"):
        user = User.objects.create_user(email=email, password=password, full_name=full_name)
        return user

    return _make


@pytest.fixture
def make_shop(db, roles):
    def _make(owner, name="Shop", cashier=None):
        shop = Shop.objects.create(name=name, owner=owner, address="addr")
        ShopSettings.objects.create(shop=shop, currency="USD")
        ShopMembership.objects.create(user=owner, shop=shop, role=roles["owner"])
        if cashier is not None:
            ShopMembership.objects.create(user=cashier, shop=shop, role=roles["cashier"])
        return shop

    return _make


@pytest.fixture
def auth(api):
    """Return an APIClient authenticated as the given user (and optional active shop)."""

    def _auth(user, shop=None):
        resp = api.post(
            "/api/v1/auth/login",
            {"email": user.email, "password": "password123"},
            format="json",
        )
        assert resp.status_code == 200, resp.content
        token = resp.data["access"]
        api.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        if shop is not None:
            api.credentials(HTTP_AUTHORIZATION=f"Bearer {token}", HTTP_X_SHOP_ID=str(shop.id))
        return api

    return _auth
