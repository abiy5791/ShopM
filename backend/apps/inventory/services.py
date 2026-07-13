"""Inventory ledger services — the single way stock ever changes (plan §3.2).

Every stock movement goes through ``record_transaction``: it appends a ledger row
and updates ``Product.stock_cached`` in the *same* DB transaction with an atomic
F() increment, so the cached balance can never drift under concurrent writes.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import F, Sum

from apps.catalog.models import Product

from .models import InventoryTransaction

# Movement types a human may enter directly via the adjustment endpoint.
MANUAL_TYPES = {
    InventoryTransaction.Type.ADJUSTMENT,
    InventoryTransaction.Type.DAMAGE,
    InventoryTransaction.Type.EXPIRY,
    InventoryTransaction.Type.RETURN_IN,
    InventoryTransaction.Type.RETURN_OUT,
}


class NegativeStockError(Exception):
    """A stock-decreasing movement would take the product below zero.

    Stock can never go negative: you cannot sell, damage, or return-out units
    that don't exist. Compensating rows (voids, purchases) add stock and are
    unaffected.
    """

    def __init__(self, product, requested: int, available: int):
        self.product = product
        self.requested = requested
        self.available = available
        super().__init__(
            f"Insufficient stock for {product.name} ({product.sku}): "
            f"requested {requested}, available {available}."
        )


def ledger_stock(product) -> int:
    """Authoritative stock: the signed sum of the product's ledger rows."""
    return (
        InventoryTransaction.objects.filter(product=product).aggregate(total=Sum("quantity"))[
            "total"
        ]
        or 0
    )


@transaction.atomic
def record_transaction(
    *,
    product,
    quantity: int,
    type: str,
    user=None,
    unit_cost: int | None = None,
    reference_type: str = "",
    reference_id: str = "",
    notes: str = "",
) -> InventoryTransaction:
    txn = InventoryTransaction.objects.create(
        shop=product.shop,
        product=product,
        quantity=quantity,
        type=type,
        user=user,
        unit_cost=unit_cost,
        reference_type=reference_type,
        reference_id=reference_id,
        notes=notes,
    )
    # Atomic increment — correct even when many sales/adjustments race.
    # Decreasing movements are floored at zero via the WHERE clause: the
    # conditional UPDATE is atomic at the DB level, so even two racing
    # last-unit sales cannot both pass (the loser matches zero rows and the
    # whole transaction — including the ledger row above — rolls back).
    qs = Product.all_objects.filter(pk=product.pk)
    if quantity < 0:
        qs = qs.filter(stock_cached__gte=-quantity)
    updated = qs.update(stock_cached=F("stock_cached") + quantity)
    if not updated:
        available = (
            Product.all_objects.filter(pk=product.pk).values_list("stock_cached", flat=True).first()
            or 0
        )
        raise NegativeStockError(product, requested=-quantity, available=available)
    product.refresh_from_db(fields=["stock_cached"])
    return txn


@transaction.atomic
def reconcile_shop(shop, *, fix: bool = True) -> list[dict]:
    """Recompute every product's cached stock from the ledger; report mismatches.

    When ``fix`` is True the cached value is corrected to match the ledger (the
    ledger is authoritative). Returns the list of mismatches found.
    """
    sums = {
        row["product"]: row["total"]
        for row in InventoryTransaction.objects.filter(shop=shop)
        .values("product")
        .annotate(total=Sum("quantity"))
    }

    mismatches: list[dict] = []
    for product in Product.all_objects.filter(shop=shop):
        ledger = sums.get(product.id, 0) or 0
        if product.stock_cached != ledger:
            mismatches.append(
                {
                    "product_id": str(product.id),
                    "sku": product.sku,
                    "cached": product.stock_cached,
                    "ledger": ledger,
                }
            )
            if fix:
                Product.all_objects.filter(pk=product.pk).update(stock_cached=ledger)
    return mismatches
