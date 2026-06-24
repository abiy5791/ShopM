from django.db import models

from apps.common.models import BaseModel
from apps.common.money import MoneyField


class Customer(BaseModel):
    """A regular customer who may buy on credit (plan §3.3, §7). The credit
    balance is derived from credit sales minus customer payments;
    ``credit_balance_cached`` is a convenience kept in sync transactionally."""

    shop = models.ForeignKey("shops.Shop", on_delete=models.CASCADE, related_name="customers")
    name = models.CharField(max_length=255)
    phone = models.CharField(max_length=32, blank=True)
    address = models.CharField(max_length=512, blank=True)
    notes = models.TextField(blank=True)
    credit_balance_cached = MoneyField(default=0)

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["shop"]), models.Index(fields=["shop", "phone"])]

    def __str__(self) -> str:
        return self.name
