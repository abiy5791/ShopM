from django.db import models
from django.db.models import Q

from apps.common.models import BaseModel, SoftDeleteModel
from apps.common.money import MoneyField


class Category(BaseModel):
    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="categories")
    name = models.CharField(max_length=128)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["shop", "name"], name="uniq_category_shop_name"),
        ]
        indexes = [models.Index(fields=["shop"])]
        verbose_name_plural = "categories"

    def __str__(self) -> str:
        return self.name


class Supplier(BaseModel):
    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="suppliers")
    name = models.CharField(max_length=255)
    phone = models.CharField(max_length=32, blank=True)
    address = models.CharField(max_length=512, blank=True)
    notes = models.TextField(blank=True)
    # Outstanding payable, derived from purchases (Σ total − Σ amount_paid). Kept
    # in sync transactionally on purchase creation (plan §3.3, mirrors customer credit).
    payable_cached = MoneyField(default=0)

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["shop"])]

    def __str__(self) -> str:
        return self.name


class Product(SoftDeleteModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"

    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="products")
    name = models.CharField(max_length=255)
    sku = models.CharField(max_length=64)
    barcode = models.CharField(max_length=64, blank=True)
    category = models.ForeignKey(
        Category, on_delete=models.SET_NULL, null=True, blank=True, related_name="products"
    )
    supplier = models.ForeignKey(
        Supplier, on_delete=models.SET_NULL, null=True, blank=True, related_name="products"
    )
    purchase_price = MoneyField(default=0)
    selling_price = MoneyField(default=0)
    unit = models.CharField(max_length=16, default="pcs")
    min_stock_alert = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.ACTIVE)
    # Convenience balance, kept in sync with the ledger (plan §3.2). The ledger
    # (apps.inventory.InventoryTransaction) remains authoritative.
    stock_cached = models.IntegerField(default=0)

    class Meta:
        ordering = ["name"]
        constraints = [
            # SKU is unique per shop among live (non-deleted) products, so a
            # soft-deleted product frees its SKU for reuse.
            models.UniqueConstraint(
                fields=["shop", "sku"],
                condition=Q(deleted_at__isnull=True),
                name="uniq_product_shop_sku_live",
            ),
        ]
        indexes = [
            models.Index(fields=["shop", "status"]),
            models.Index(fields=["shop", "barcode"]),
            models.Index(fields=["category"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.sku})"

    @property
    def is_low_stock(self) -> bool:
        return self.stock_cached <= self.min_stock_alert
