from django.conf import settings as django_settings
from django.db import models

from apps.common.models import BaseModel
from apps.common.money import MoneyField


class Sale(BaseModel):
    """A completed POS transaction. Idempotent on ``client_uuid`` (plan §3.4)."""

    class Status(models.TextChoices):
        COMPLETED = "completed", "Completed"
        VOIDED = "voided", "Voided"

    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="sales")
    # Client-generated idempotency key (UUID). Globally unique so a replay — online
    # retry or offline outbox re-send — never double-records.
    client_uuid = models.UUIDField(unique=True)
    cashier = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="sales",
    )
    # Optional customer; set when a sale is on credit (plan §3.3, §4).
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sales",
    )
    # Money, all integer minor units (plan §3.5).
    subtotal = MoneyField(default=0)
    discount = MoneyField(default=0)
    tax = MoneyField(default=0)
    total = MoneyField(default=0)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.COMPLETED)
    notes = models.TextField(blank=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="voided_sales",
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["shop", "-created_at"]),
            models.Index(fields=["shop", "status"]),
        ]

    def __str__(self) -> str:
        return f"Sale {self.id} ({self.status})"


class SaleItem(BaseModel):
    """A line on a sale. Prices are snapshotted so historic receipts never change
    when a product's price later changes (plan §7)."""

    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(
        "catalog.Product", on_delete=models.PROTECT, related_name="sale_items"
    )
    name_snapshot = models.CharField(max_length=255)
    sku_snapshot = models.CharField(max_length=64, blank=True)
    unit_price_snapshot = MoneyField()
    quantity = models.PositiveIntegerField()
    line_total = MoneyField()

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.quantity} x {self.name_snapshot}"


class Payment(BaseModel):
    """A payment received. Linked to a sale, or (Phase 4) standalone credit settlement."""

    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        BANK = "bank", "Bank"
        MOBILE_MONEY = "mobile_money", "Mobile money"

    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="payments")
    sale = models.ForeignKey(
        Sale, on_delete=models.CASCADE, null=True, blank=True, related_name="payments"
    )
    # Set for credit-sale payments and standalone settlements (plan §3.3).
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="payments",
    )
    method = models.CharField(max_length=16, choices=Method.choices)
    amount = MoneyField()
    received_at = models.DateTimeField(auto_now_add=True)
    user = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="payments",
    )

    class Meta:
        ordering = ["received_at"]
        indexes = [models.Index(fields=["shop", "-received_at"])]

    def __str__(self) -> str:
        return f"{self.method} {self.amount}"
