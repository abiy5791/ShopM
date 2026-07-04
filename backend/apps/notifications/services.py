"""Notification triggers (plan §11 Phase 7). Each helper creates a Notification
when its condition holds, de-duplicating against existing *unread* alerts so a
repeated condition doesn't spam the owner."""

from __future__ import annotations

from django.conf import settings
from django.utils import timezone

from .models import Notification


def _exists_unread(shop, ntype, **payload_filters) -> bool:
    qs = Notification.objects.filter(shop=shop, type=ntype, read_at__isnull=True)
    for key, value in payload_filters.items():
        qs = qs.filter(**{f"payload__{key}": value})
    return qs.exists()


def notify_low_stock(product) -> None:
    if product.stock_cached > product.min_stock_alert:
        return
    is_out = product.stock_cached <= 0
    ntype = Notification.Type.OUT_OF_STOCK if is_out else Notification.Type.LOW_STOCK
    if _exists_unread(product.shop, ntype, product_id=str(product.id)):
        return
    Notification.objects.create(
        shop=product.shop,
        type=ntype,
        level=Notification.Level.CRITICAL if is_out else Notification.Level.WARN,
        title=(
            f"{product.name} is out of stock"
            if is_out
            else f"{product.name} is low on stock ({product.stock_cached} left)"
        ),
        payload={"product_id": str(product.id), "sku": product.sku, "stock": product.stock_cached},
    )


def notify_large_expense(expense) -> None:
    threshold = getattr(settings, "LARGE_EXPENSE_THRESHOLD", 100_000)
    if expense.amount < threshold:
        return
    Notification.objects.create(
        shop=expense.shop,
        type=Notification.Type.LARGE_EXPENSE,
        level=Notification.Level.WARN,
        title=f"Large expense recorded ({expense.amount} minor units)",
        payload={"expense_id": str(expense.id), "amount": expense.amount},
    )


def notify_large_void(sale) -> None:
    threshold = getattr(settings, "LARGE_VOID_THRESHOLD", 100_000)
    if sale.total < threshold:
        return
    Notification.objects.create(
        shop=sale.shop,
        type=Notification.Type.LARGE_VOID,
        level=Notification.Level.WARN,
        title=f"Large sale voided ({sale.total} minor units)",
        payload={"sale_id": str(sale.id), "total": sale.total},
    )


def notify_failed_login(email: str, ip: str | None) -> None:
    """After N failed attempts for an email within a window, alert the owner of
    each shop that email belongs to (plan §11 Phase 7 DoD)."""
    from apps.accounts.models import User
    from apps.activity.models import ActivityLog

    threshold = getattr(settings, "FAILED_LOGIN_THRESHOLD", 5)
    window = timezone.now() - timezone.timedelta(minutes=15)
    recent = ActivityLog.objects.filter(
        action="auth.login_failed", created_at__gte=window, metadata__email=email
    ).count()
    if recent < threshold:
        return

    user = User.objects.filter(email=email).first()
    if user is None:
        return
    for membership in user.memberships.select_related("shop").all():
        if _exists_unread(membership.shop, Notification.Type.FAILED_LOGIN, email=email):
            continue
        Notification.objects.create(
            shop=membership.shop,
            type=Notification.Type.FAILED_LOGIN,
            level=Notification.Level.CRITICAL,
            title=f"{recent} failed sign-in attempts for {email}",
            payload={"email": email, "ip": ip, "attempts": recent},
        )


def notify_daily_summary(shop, *, title: str, payload: dict) -> None:
    Notification.objects.create(
        shop=shop,
        type=Notification.Type.DAILY_SUMMARY,
        level=Notification.Level.INFO,
        title=title,
        payload=payload,
    )
