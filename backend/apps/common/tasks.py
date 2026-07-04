from celery import shared_task

from .backup import create_backup


@shared_task
def scheduled_backup() -> str:
    """Nightly database backup (plan §11 Phase 7)."""
    return create_backup()
