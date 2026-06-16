from django.conf import settings as django_settings
from django.db import models

from apps.common.models import BaseModel, SoftDeleteModel


class Shop(SoftDeleteModel):
    """A shop is the tenant boundary — all business data is scoped to one (plan §3.1)."""

    name = models.CharField(max_length=255)
    address = models.CharField(max_length=512, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    owner = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_shops",
    )

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["owner"])]

    def __str__(self) -> str:
        return self.name


class ShopMembership(BaseModel):
    """Grants a user access to a shop with a role (plan §3.1)."""

    user = models.ForeignKey(
        django_settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="memberships")
    role = models.ForeignKey("accounts.Role", on_delete=models.PROTECT, related_name="memberships")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "shop"], name="uniq_user_shop_membership"),
        ]
        indexes = [
            models.Index(fields=["user"]),
            models.Index(fields=["shop"]),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} @ {self.shop_id} ({self.role_id})"


class ShopSettings(BaseModel):
    """One settings row per shop (plan §7)."""

    shop = models.OneToOneField(Shop, on_delete=models.CASCADE, related_name="settings")
    currency = models.CharField(max_length=3, default="USD")
    # Percentage with 2 dp (e.g. 15.00). Exact Decimal, never a float.
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    logo_url = models.URLField(blank=True)
    receipt_footer = models.CharField(max_length=512, blank=True)
    low_stock_default = models.PositiveIntegerField(default=5)
    language = models.CharField(max_length=8, default="en")
    timezone = models.CharField(max_length=64, default="UTC")

    class Meta:
        verbose_name = "shop settings"
        verbose_name_plural = "shop settings"

    def __str__(self) -> str:
        return f"Settings({self.shop_id})"
