"""Single entry point for writing audit rows. Use this everywhere — never create
ActivityLog rows ad hoc (plan §3.6, §7)."""

from __future__ import annotations

from typing import Any


def log_activity(
    *,
    action: str,
    user=None,
    shop=None,
    entity_type: str = "",
    entity_id: Any = None,
    metadata: dict | None = None,
    level: str = "info",
    ip: str | None = None,
):
    # Local import keeps this module import-safe from anywhere (incl. app loading).
    from .models import ActivityLog

    return ActivityLog.objects.create(
        action=action,
        user=user,
        shop=shop,
        entity_type=entity_type,
        entity_id="" if entity_id is None else str(entity_id),
        metadata=metadata or {},
        level=level,
        ip=ip,
    )
