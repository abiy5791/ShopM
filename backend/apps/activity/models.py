from django.conf import settings as django_settings
from django.db import models

from apps.common.models import BaseModel


class ActivityLog(BaseModel):
    """Append-only audit trail (plan §7). Rows are never updated or deleted."""

    class Level(models.TextChoices):
        INFO = "info", "Info"
        WARN = "warn", "Warning"
        CRITICAL = "critical", "Critical"

    # Nullable for system-level events (e.g. failed logins, reconciliation jobs).
    shop = models.ForeignKey(
        "shops.Shop",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="activity_logs",
    )
    user = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="activity_logs",
    )
    action = models.CharField(max_length=64, db_index=True)
    entity_type = models.CharField(max_length=64, blank=True)
    entity_id = models.CharField(max_length=64, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    level = models.CharField(max_length=8, choices=Level.choices, default=Level.INFO)
    ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["shop", "-created_at"]),
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["action"]),
        ]

    def __str__(self) -> str:
        return f"{self.action} by {self.user_id} @ {self.created_at:%Y-%m-%d %H:%M}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError("ActivityLog is append-only and cannot be updated.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("ActivityLog is append-only and cannot be deleted.")
