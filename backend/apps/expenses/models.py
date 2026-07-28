from django.conf import settings as django_settings
from django.db import models

from apps.common.models import BaseModel, SoftDeleteModel
from apps.common.money import MoneyField

from .validators import validate_receipt_image


class ExpenseCategory(BaseModel):
    shop = models.ForeignKey(
        "shops.Shop", on_delete=models.CASCADE, related_name="expense_categories"
    )
    name = models.CharField(max_length=128)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["shop", "name"], name="uniq_expense_category_shop_name"
            ),
        ]
        verbose_name_plural = "expense categories"

    def __str__(self) -> str:
        return self.name


class Expense(SoftDeleteModel):
    class Recurrence(models.TextChoices):
        ONE_TIME = "one_time", "One-time"
        MONTHLY = "monthly", "Monthly"

    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="expenses")
    category = models.ForeignKey(
        ExpenseCategory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
    )
    amount = MoneyField()
    # A monthly cost (salary, rent) is entered once for the month; daily views
    # charge only its per-day share so one day isn't sunk by a whole month's cost.
    recurrence = models.CharField(
        max_length=16, choices=Recurrence.choices, default=Recurrence.ONE_TIME
    )
    date = models.DateField()
    description = models.CharField(max_length=512, blank=True)
    # FileField uses Django's storage abstraction — local in dev, S3 in prod by
    # swapping STORAGES (plan §4, §11 Phase 3). No code change needed to switch.
    receipt_image = models.FileField(
        upload_to="expenses/%Y/%m/",
        null=True,
        blank=True,
        validators=[validate_receipt_image],
    )
    user = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="expenses",
    )

    class Meta:
        ordering = ["-date", "-created_at"]
        indexes = [
            models.Index(fields=["shop", "-date"]),
            models.Index(fields=["category"]),
        ]

    def __str__(self) -> str:
        return f"{self.amount} on {self.date}"
