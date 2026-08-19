from django.conf import settings as django_settings
from django.db import models

from apps.common.models import BaseModel
from apps.common.money import MoneyField, currency_of, format_money


class Purchase(BaseModel):
    """A stock purchase from a supplier. Creating one stocks items in via the
    ledger (plan §7, Phase 3)."""

    class PaymentStatus(models.TextChoices):
        PAID = "paid", "Paid"
        PARTIAL = "partial", "Partial"
        UNPAID = "unpaid", "Unpaid"

    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="purchases")
    supplier = models.ForeignKey(
        "catalog.Supplier",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="purchases",
    )
    total = MoneyField(default=0)
    amount_paid = MoneyField(default=0)
    payment_status = models.CharField(
        max_length=8, choices=PaymentStatus.choices, default=PaymentStatus.UNPAID
    )
    date = models.DateField()
    notes = models.TextField(blank=True)
    user = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="purchases",
    )

    class Meta:
        ordering = ["-date", "-created_at"]
        indexes = [
            models.Index(fields=["shop", "-date"]),
            models.Index(fields=["shop", "payment_status"]),
        ]

    def __str__(self) -> str:
        return f"Purchase {self.id} ({self.payment_status})"


class PurchaseItem(BaseModel):
    purchase = models.ForeignKey(Purchase, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(
        "catalog.Product", on_delete=models.PROTECT, related_name="purchase_items"
    )
    quantity = models.PositiveIntegerField()
    unit_cost = MoneyField()
    line_total = MoneyField()

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return (
            f"{self.quantity} x {self.product_id} @ "
            f"{format_money(self.unit_cost, currency_of(self))}"
        )
