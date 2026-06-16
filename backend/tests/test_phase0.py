"""Phase 0 DoD assertions (plan §11 Phase 0)."""

import pytest

from apps.activity.models import ActivityLog

pytestmark = pytest.mark.django_db


def test_login_returns_tokens_and_writes_activity(api, make_user):
    user = make_user("a@shopm.local")
    resp = api.post(
        "/api/v1/auth/login",
        {"email": user.email, "password": "password123"},
        format="json",
    )
    assert resp.status_code == 200
    assert "access" in resp.data and "refresh" in resp.data
    assert resp.data["user"]["email"] == user.email
    assert ActivityLog.objects.filter(action="auth.login", user=user).exists()


def test_failed_login_is_logged(api, make_user):
    user = make_user("a@shopm.local")
    resp = api.post(
        "/api/v1/auth/login",
        {"email": user.email, "password": "wrong"},
        format="json",
    )
    assert resp.status_code == 401
    assert ActivityLog.objects.filter(action="auth.login_failed").exists()


def test_me_returns_memberships(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    make_shop(owner, name="Shop A")
    make_shop(owner, name="Shop B")
    client = auth(owner)
    resp = client.get("/api/v1/me")
    assert resp.status_code == 200
    assert len(resp.data["memberships"]) == 2
    assert {m["role"] for m in resp.data["memberships"]} == {"owner"}


def test_shops_lists_only_my_shops_with_role(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    other = make_user("other@shopm.local")
    make_shop(owner, name="Mine")
    make_shop(other, name="NotMine")
    client = auth(owner)
    resp = client.get("/api/v1/shops")
    assert resp.status_code == 200
    names = [s["name"] for s in resp.data["results"]]
    assert names == ["Mine"]
    assert resp.data["results"][0]["my_role"] == "owner"


def test_cross_shop_access_returns_404(make_user, make_shop, auth):
    owner_a = make_user("a@shopm.local")
    owner_b = make_user("b@shopm.local")
    make_shop(owner_a, name="A")
    shop_b = make_shop(owner_b, name="B")
    # owner_a is authenticated but sends owner_b's shop id.
    client = auth(owner_a)
    resp = client.get("/api/v1/settings", HTTP_X_SHOP_ID=str(shop_b.id))
    assert resp.status_code == 404


def test_cashier_cannot_read_settings(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    cashier = make_user("cashier@shopm.local")
    shop = make_shop(owner, name="Shop", cashier=cashier)
    client = auth(cashier, shop=shop)
    resp = client.get("/api/v1/settings")
    assert resp.status_code == 403


def test_owner_updates_settings_and_it_is_logged(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="Shop")
    client = auth(owner, shop=shop)

    get_resp = client.get("/api/v1/settings")
    assert get_resp.status_code == 200

    patch_resp = client.patch("/api/v1/settings", {"low_stock_default": 12}, format="json")
    assert patch_resp.status_code == 200
    assert patch_resp.data["low_stock_default"] == 12
    assert ActivityLog.objects.filter(action="settings.update", shop=shop).exists()


def test_missing_shop_header_is_rejected(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    make_shop(owner, name="Shop")
    client = auth(owner)  # no active shop set
    resp = client.get("/api/v1/settings")
    assert resp.status_code == 400
    assert resp.data["code"] == "shop_required"
