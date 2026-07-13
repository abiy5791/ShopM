"""Phase B (v2 plan §3): owner administration — staff & branch management."""

import pytest

from apps.accounts.models import User
from apps.activity.models import ActivityLog
from apps.shops.models import Shop, ShopMembership, ShopSettings

pytestmark = pytest.mark.django_db

STRONG_PW = "K3bede!Boutique42"


@pytest.fixture
def owner_setup(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    shop = make_shop(owner, name="Bole")
    return owner, shop, auth(owner)


def _staff_payload(shop, email="cashier@shopm.local", **overrides):
    return {
        "full_name": "Meron Cashier",
        "email": email,
        "password": STRONG_PW,
        "memberships": [{"shop": str(shop.id), "role": "cashier"}],
        **overrides,
    }


# ------------------------------------------------------------------- staff
def test_owner_creates_cashier_who_can_immediately_work(owner_setup, api):
    owner, shop, client = owner_setup

    resp = client.post("/api/v1/staff", _staff_payload(shop), format="json")
    assert resp.status_code == 201, resp.content
    assert resp.data["memberships"][0]["role"] == "cashier"
    assert ActivityLog.objects.filter(action="staff.create").exists()

    # The new cashier can log in and reach shop data straight away.
    login = api.post(
        "/api/v1/auth/login",
        {"email": "cashier@shopm.local", "password": STRONG_PW},
        format="json",
    )
    assert login.status_code == 200
    api.credentials(
        HTTP_AUTHORIZATION=f"Bearer {login.data['access']}", HTTP_X_SHOP_ID=str(shop.id)
    )
    assert api.get("/api/v1/products").status_code == 200


def test_weak_password_is_rejected(owner_setup):
    owner, shop, client = owner_setup
    resp = client.post("/api/v1/staff", _staff_payload(shop, password="password123"), format="json")
    assert resp.status_code == 400
    assert "password" in resp.data["fields"]
    assert not User.objects.filter(email="cashier@shopm.local").exists()


def test_duplicate_email_is_rejected(owner_setup, make_user):
    owner, shop, client = owner_setup
    make_user("taken@shopm.local")
    resp = client.post(
        "/api/v1/staff", _staff_payload(shop, email="taken@shopm.local"), format="json"
    )
    assert resp.status_code == 400


def test_staff_must_get_at_least_one_branch(owner_setup):
    owner, shop, client = owner_setup
    resp = client.post("/api/v1/staff", _staff_payload(shop, memberships=[]), format="json")
    assert resp.status_code == 400


def test_cashier_cannot_reach_staff_api(owner_setup, make_user, make_shop, auth):
    owner, shop, _ = owner_setup
    cashier = make_user("c@shopm.local")
    make_shop(owner, name="Piassa", cashier=cashier)  # membership via fixture
    client = auth(cashier)
    assert client.get("/api/v1/staff").status_code == 403
    assert client.post("/api/v1/staff", {}, format="json").status_code == 403


def test_owners_cannot_see_or_touch_each_others_staff(owner_setup, make_user, make_shop, auth):
    owner_a, shop_a, client_a = owner_setup
    client_a.post("/api/v1/staff", _staff_payload(shop_a), format="json")
    cashier = User.objects.get(email="cashier@shopm.local")

    owner_b = make_user("other@shopm.local")
    make_shop(owner_b, name="Merkato")
    client_b = auth(owner_b)

    listed = client_b.get("/api/v1/staff")
    emails = [u["email"] for u in listed.data["results"]]
    assert "cashier@shopm.local" not in emails
    assert client_b.patch(f"/api/v1/staff/{cashier.id}", {"is_active": False}).status_code == 404


def test_owner_cannot_modify_self_or_another_owner(owner_setup, make_user, roles):
    owner, shop, client = owner_setup
    resp = client.patch(f"/api/v1/staff/{owner.id}", {"is_active": False}, format="json")
    assert resp.status_code == 403  # self

    # A fellow owner who also has a membership in my shop is still off-limits.
    other = make_user("partner@shopm.local")
    Shop.objects.create(name="Theirs", owner=other)
    ShopMembership.objects.create(user=other, shop=shop, role=roles["cashier"])
    resp = client.patch(f"/api/v1/staff/{other.id}", {"is_active": False}, format="json")
    assert resp.status_code == 403


def test_deactivation_blocks_login_and_reset_password_works(owner_setup, api):
    owner, shop, client = owner_setup
    client.post("/api/v1/staff", _staff_payload(shop), format="json")
    cashier = User.objects.get(email="cashier@shopm.local")

    resp = client.patch(f"/api/v1/staff/{cashier.id}", {"is_active": False}, format="json")
    assert resp.status_code == 200 and resp.data["is_active"] is False
    login = api.post(
        "/api/v1/auth/login",
        {"email": "cashier@shopm.local", "password": STRONG_PW},
        format="json",
    )
    assert login.status_code == 401

    # Reactivate with a new owner-set password.
    resp = client.patch(
        f"/api/v1/staff/{cashier.id}",
        {"is_active": True, "password": "N3w!Boutique2026"},
        format="json",
    )
    assert resp.status_code == 200
    login = api.post(
        "/api/v1/auth/login",
        {"email": "cashier@shopm.local", "password": "N3w!Boutique2026"},
        format="json",
    )
    assert login.status_code == 200


def test_membership_grant_role_change_and_revoke(owner_setup, make_shop):
    owner, shop, client = owner_setup
    second = make_shop(owner, name="Piassa")
    client.post("/api/v1/staff", _staff_payload(shop), format="json")
    cashier = User.objects.get(email="cashier@shopm.local")

    # Grant access to the second branch.
    resp = client.post(
        f"/api/v1/staff/{cashier.id}/memberships",
        {"shop": str(second.id), "role": "cashier"},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    assert len(resp.data["memberships"]) == 2

    # Re-posting the same branch with a new role is a role change.
    resp = client.post(
        f"/api/v1/staff/{cashier.id}/memberships",
        {"shop": str(second.id), "role": "owner"},
        format="json",
    )
    roles_by_shop = {m["shop_id"]: m["role"] for m in resp.data["memberships"]}
    assert roles_by_shop[str(second.id)] == "owner"

    # Revoke.
    membership_id = next(
        m["id"] for m in resp.data["memberships"] if m["shop_id"] == str(second.id)
    )
    resp = client.delete(f"/api/v1/staff/{cashier.id}/memberships/{membership_id}")
    assert resp.status_code == 200
    assert len(resp.data["memberships"]) == 1


def test_membership_grant_limited_to_owned_branches(owner_setup, make_user, make_shop):
    owner, shop, client = owner_setup
    client.post("/api/v1/staff", _staff_payload(shop), format="json")
    cashier = User.objects.get(email="cashier@shopm.local")
    foreign = make_shop(make_user("other@shopm.local"), name="Foreign")

    resp = client.post(
        f"/api/v1/staff/{cashier.id}/memberships",
        {"shop": str(foreign.id), "role": "cashier"},
        format="json",
    )
    assert resp.status_code == 404


# ----------------------------------------------------------------- branches
def test_owner_creates_branch_with_settings_and_membership(owner_setup):
    owner, shop, client = owner_setup
    # Give the first branch distinctive settings; new branches inherit them.
    ShopSettings.objects.filter(shop=shop).update(currency="KES", low_stock_default=9)

    resp = client.post(
        "/api/v1/shops", {"name": "Piassa", "address": "Piassa, Addis"}, format="json"
    )
    assert resp.status_code == 201, resp.content
    assert resp.data["my_role"] == "owner"
    assert resp.data["currency"] == "KES"

    new_shop = Shop.objects.get(name="Piassa")
    assert new_shop.settings.low_stock_default == 9
    assert ShopMembership.objects.filter(user=owner, shop=new_shop, role__name="owner").exists()
    assert ActivityLog.objects.filter(action="shop.create").exists()

    # It appears in the switcher list.
    names = [s["name"] for s in client.get("/api/v1/shops").data["results"]]
    assert "Piassa" in names


def test_cashier_cannot_create_or_edit_branches(make_user, make_shop, auth):
    owner = make_user("owner@shopm.local")
    cashier = make_user("c@shopm.local")
    shop = make_shop(owner, name="Bole", cashier=cashier)
    client = auth(cashier)

    assert client.post("/api/v1/shops", {"name": "Nope"}, format="json").status_code == 403
    assert client.patch(f"/api/v1/shops/{shop.id}", {"name": "Hack"}).status_code == 403


def test_owner_cannot_edit_someone_elses_branch(owner_setup, make_user, make_shop):
    owner_a, shop_a, client_a = owner_setup
    foreign = make_shop(make_user("other@shopm.local"), name="Foreign")
    assert client_a.patch(f"/api/v1/shops/{foreign.id}", {"name": "Hack"}).status_code == 404


def test_branch_edit_and_archive(owner_setup, make_shop):
    owner, shop, client = owner_setup
    second = make_shop(owner, name="Piassa")

    resp = client.patch(f"/api/v1/shops/{second.id}", {"phone": "+251911000000"}, format="json")
    assert resp.status_code == 200 and resp.data["phone"] == "+251911000000"

    resp = client.delete(f"/api/v1/shops/{second.id}")
    assert resp.status_code == 204
    names = [s["name"] for s in client.get("/api/v1/shops").data["results"]]
    assert "Piassa" not in names
    assert ActivityLog.objects.filter(action="shop.archive").exists()


def test_cannot_archive_only_branch(owner_setup):
    owner, shop, client = owner_setup
    resp = client.delete(f"/api/v1/shops/{shop.id}")
    assert resp.status_code == 400
