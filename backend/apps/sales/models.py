from django.conf import settings as django_settings
from django.db import models
from django.utils import timezone

from apps.common.models import BaseModel
from apps.common.money import MoneyField, currency_of, format_money


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
    # When the sale actually happened — the BUSINESS date every report is keyed
    # on. Normally "now", but an owner may record a sale that was missed on an
    # earlier day (see apps.sales.backdating). ``created_at`` stays the untouched
    # audit fact of when the row was entered, so a backdate is always visible as
    # the gap between the two.
    occurred_at = models.DateTimeField(default=timezone.now, db_index=True)
    notes = models.TextField(blank=True)
    # Set the first time an owner corrects a mis-recorded sale. The full
    # before/after history lives in SaleAmendment; these two just let a list
    # flag the row without a join.
    amended_at = models.DateTimeField(null=True, blank=True)
    amended_by = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="amended_sales",
    )
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="voided_sales",
    )

    class Meta:
        # Business order first; entry order breaks ties among sales booked to the
        # same instant (several catch-up sales backdated to one day).
        ordering = ["-occurred_at", "-created_at"]
        indexes = [
            models.Index(fields=["shop", "-occurred_at"]),
            models.Index(fields=["shop", "-created_at"]),
            models.Index(fields=["shop", "status"]),
        ]

    def __str__(self) -> str:
        return f"Sale {self.id} ({self.status})"

    @property
    def is_backdated(self) -> bool:
        """True when the sale was booked to a day earlier than it was entered."""
        return timezone.localdate(self.occurred_at) < timezone.localdate(self.created_at)

    @property
    def is_amended(self) -> bool:
        """True when the sale has been corrected at least once since it was rung up."""
        return self.amended_at is not None


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
        TELEBIRR = "telebirr", "Telebirr"
        CBE = "cbe", "CBE"
        ABYSSINIA = "abyssinia", "Bank of Abyssinia"
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
    # Defaults to now, but is set to the sale's ``occurred_at`` for a backdated
    # sale so the day's takings reconcile with the day's sales. Never client-set:
    # no writable serializer exposes it.
    received_at = models.DateTimeField(default=timezone.now, db_index=True)
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
        return f"{self.method} {format_money(self.amount, currency_of(self))}"


class SaleAmendment(BaseModel):
    """One correction to a sale — append-only, never edited or deleted.

    Editing a sale rewrites money that has already been reported on, so every
    change leaves a permanent record of what it was, what it became, and why.
    The ``changes`` list is computed once at write time and stored, so a historic
    amendment always reads the same even if the diffing code later changes.
    """

    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="amendments")
    user = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sale_amendments",
    )
    # Why the correction was needed. Required at the API — a money edit with no
    # stated cause is exactly what an audit trail exists to prevent.
    reason = models.CharField(max_length=255)
    # Full snapshots either side of the edit (totals, lines, payments, dates).
    before = models.JSONField(default=dict)
    after = models.JSONField(default=dict)
    # Human-readable diff: [{"field": "Total", "from": "...", "to": "..."}, ...]
    changes = models.JSONField(default=list)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["sale", "-created_at"])]

    def __str__(self) -> str:
        return f"Amendment of {self.sale_id} ({len(self.changes)} changes)"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError("SaleAmendment is append-only and cannot be updated.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("SaleAmendment is append-only and cannot be deleted.")
