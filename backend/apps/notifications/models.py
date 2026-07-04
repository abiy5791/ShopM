from django.db import models
from django.utils import timezone

from apps.common.models import BaseModel


class Notification(BaseModel):
    """A surfaced alert for a shop (plan §7, Phase 7)."""

    class Type(models.TextChoices):
        LOW_STOCK = "low_stock", "Low stock"
        OUT_OF_STOCK = "out_of_stock", "Out of stock"
        LARGE_EXPENSE = "large_expense", "Large expense"
        LARGE_VOID = "large_void", "Large void"
        FAILED_LOGIN = "failed_login", "Failed logins"
        DAILY_SUMMARY = "daily_summary", "Daily summary"

    class Level(models.TextChoices):
        INFO = "info", "Info"
        WARN = "warn", "Warning"
        CRITICAL = "critical", "Critical"

    # Nullable for system-level notifications (e.g. failed logins with no shop context).
    shop = models.ForeignKey(
        "shops.Shop", on_delete=models.CASCADE, null=True, blank=True, related_name="notifications"
    )
    type = models.CharField(max_length=32, choices=Type.choices)
    level = models.CharField(max_length=8, choices=Level.choices, default=Level.INFO)
    title = models.CharField(max_length=255)
    payload = models.JSONField(default=dict, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["shop", "-created_at"]),
            models.Index(fields=["shop", "read_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.type}: {self.title}"

    def mark_read(self):
        if self.read_at is None:
            self.read_at = timezone.now()
            self.save(update_fields=["read_at", "updated_at"])
