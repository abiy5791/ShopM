from celery import shared_task

from apps.activity.services import log_activity
from apps.shops.models import Shop

from .services import reconcile_shop


@shared_task
def reconcile_all_shops() -> dict:
    """Nightly job (plan §3.2): recompute cached stock from the ledger for every
    shop and log any mismatch it had to correct."""
    results: dict[str, list] = {}
    for shop in Shop.objects.all():
        mismatches = reconcile_shop(shop, fix=True)
        results[str(shop.id)] = mismatches
        if mismatches:
            log_activity(
                action="inventory.reconcile_mismatch",
                shop=shop,
                level="warn",
                metadata={"count": len(mismatches), "mismatches": mismatches},
            )
    return results
