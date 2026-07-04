"""Daily owner summary (plan §11 Phase 6). Behind the OWNER_DAILY_SUMMARY_ENABLED
feature flag; email first, WhatsApp stubbed for future work."""

from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.utils import timezone

from apps.common.money import format_money

from .services import compare_shops


def _render_summary(user, day) -> str:
    data = compare_shops(user, start=day, end=day)
    lines = [f"ShopM daily summary for {day}", ""]
    for row in data["shops"]:
        lines.append(
            f"#{row['rank']} {row['shop_name']}: "
            f"sales {format_money(row['sales_total'], row['currency'])} "
            f"({row['sales_count']} txns), "
            f"net profit {format_money(row['net_profit'], row['currency'])}"
        )
    if not data["shops"]:
        lines.append("No shops found.")
    return "\n".join(lines)


def send_whatsapp_summary(user, text: str) -> None:  # pragma: no cover
    """Stub — WhatsApp delivery is future work (plan §16)."""
    raise NotImplementedError("WhatsApp summaries are not implemented in v1.")


@shared_task
def send_daily_summaries() -> int:
    """Email every shop owner yesterday's per-shop summary. Returns emails sent."""
    if not getattr(settings, "OWNER_DAILY_SUMMARY_ENABLED", False):
        return 0

    User = get_user_model()
    yesterday = timezone.now().date() - timedelta(days=1)
    sent = 0
    owners = User.objects.filter(owned_shops__isnull=False, is_active=True).distinct()
    for owner in owners:
        body = _render_summary(owner, yesterday)
        send_mail(
            subject=f"ShopM daily summary — {yesterday}",
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[owner.email],
        )
        sent += 1
    return sent
