from django.conf import settings as django_settings
from django.db import models

from apps.common.models import BaseModel
from apps.common.money import MoneyField


class InventoryTransaction(BaseModel):
    """The stock ledger (plan §3.2). Append-only: the signed sum of a product's
    rows IS its stock. Rows are never updated or deleted; corrections are new
    compensating rows."""

    class Type(models.TextChoices):
        PURCHASE = "purchase", "Purchase"
        SALE = "sale", "Sale"
        ADJUSTMENT = "adjustment", "Adjustment"
        DAMAGE = "damage", "Damage"
        EXPIRY = "expiry", "Expiry"
        RETURN_IN = "return_in", "Return in"
        RETURN_OUT = "return_out", "Return out"
        RECONCILE = "reconcile", "Reconcile"

    shop = models.ForeignKey(
        "shops.Shop", on_delete=models.CASCADE, related_name="inventory_transactions"
    )
    product = models.ForeignKey(
        "catalog.Product", on_delete=models.PROTECT, related_name="inventory_transactions"
    )
    quantity = models.IntegerField(help_text="Signed: positive = stock in, negative = stock out.")
    type = models.CharField(max_length=16, choices=Type.choices)
    unit_cost = MoneyField(null=True, blank=True)
    # Generic link to the source document (sale/purchase), set in later phases.
    reference_type = models.CharField(max_length=32, blank=True)
    reference_id = models.CharField(max_length=64, blank=True)
    user = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inventory_transactions",
    )
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["shop", "product", "-created_at"]),
            models.Index(fields=["type"]),
            models.Index(fields=["reference_type", "reference_id"]),
        ]

    def __str__(self) -> str:
        return f"{self.type} {self.quantity:+d} of {self.product_id}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError("InventoryTransaction is append-only and cannot be updated.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("InventoryTransaction is append-only and cannot be deleted.")
