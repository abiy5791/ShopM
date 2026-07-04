from datetime import timedelta

from celery import shared_task
from django.db.models import Sum
from django.utils import timezone

from apps.sales.models import Sale
from apps.shops.models import Shop

from .services import notify_daily_summary


@shared_task
def push_daily_summaries() -> int:
    """Create a daily-summary notification per shop for yesterday's sales."""
    yesterday = timezone.now().date() - timedelta(days=1)
    created = 0
    for shop in Shop.objects.filter(deleted_at__isnull=True):
        total = (
            Sale.objects.filter(
                shop=shop, status=Sale.Status.COMPLETED, created_at__date=yesterday
            ).aggregate(s=Sum("total"))["s"]
            or 0
        )
        notify_daily_summary(
            shop,
            title=f"Yesterday's sales: {total} minor units",
            payload={"date": str(yesterday), "sales_total": total},
        )
        created += 1
    return created
