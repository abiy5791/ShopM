"""Phase 8 assertions (plan §8, §14): hardening."""

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

pytestmark = pytest.mark.django_db


def test_healthz_reports_db_ok(api):
    resp = api.get("/healthz/")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "db": True}


def test_login_is_rate_limited(make_user, monkeypatch):
    make_user("o@shopm.local")
    cache.clear()
    # The throttle reads its rates from this class attribute; patch it directly so
    # the low rate is deterministic regardless of test ordering.
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", {"login": "3/min"})
    client = APIClient()
    codes = [
        client.post(
            "/api/v1/auth/login",
            {"email": "o@shopm.local", "password": "password123"},
            format="json",
        ).status_code
        for _ in range(4)
    ]
    assert codes[:3] == [200, 200, 200]
    assert codes[3] == 429  # 4th within the window is throttled


def test_logout_revokes_refresh_token(make_user, api):
    """A blacklisted refresh token can no longer mint access tokens (plan §14)."""
    make_user("o@shopm.local")
    login = api.post(
        "/api/v1/auth/login",
        {"email": "o@shopm.local", "password": "password123"},
        format="json",
    )
    refresh = login.data["refresh"]
    access = login.data["access"]

    api.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    assert api.post("/api/v1/auth/logout", {"refresh": refresh}, format="json").status_code == 205

    # After logout the refresh token is blacklisted and can't mint access tokens.
    api.credentials()
    assert api.post("/api/v1/auth/refresh", {"refresh": refresh}, format="json").status_code == 401
