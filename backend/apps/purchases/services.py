"""Purchase creation (plan §7, Phase 3). Stocks items in through the ledger in the
same DB transaction, and derives the payment status."""

from __future__ import annotations

from django.db import transaction
from django.db.models import F, Sum
from django.utils import timezone

from apps.catalog.models import Supplier
from apps.inventory.models import InventoryTransaction
from apps.inventory.services import record_transaction

from .models import Purchase, PurchaseItem


def recompute_supplier_payable(supplier: Supplier) -> int:
    """Supplier payable = Σ(purchase total − amount_paid). Mirrors customer credit."""
    outstanding = (
        Purchase.objects.filter(supplier=supplier).aggregate(
            owed=Sum(F("total") - F("amount_paid"))
        )["owed"]
        or 0
    )
    Supplier.objects.filter(pk=supplier.pk).update(payable_cached=outstanding)
    return outstanding


def derive_payment_status(amount_paid: int, total: int) -> str:
    if amount_paid <= 0:
        return Purchase.PaymentStatus.UNPAID
    if amount_paid >= total:
        return Purchase.PaymentStatus.PAID
    return Purchase.PaymentStatus.PARTIAL


@transaction.atomic
def create_purchase(*, shop, user, supplier, items, amount_paid=0, date=None, notes="") -> Purchase:
    total = 0
    rows = []
    for item in items:
        product = item["product"]
        quantity = item["quantity"]
        unit_cost = item["unit_cost"]
        line_total = unit_cost * quantity
        total += line_total
        rows.append((product, quantity, unit_cost, line_total))

    purchase = Purchase.objects.create(
        shop=shop,
        supplier=supplier,
        total=total,
        amount_paid=amount_paid,
        payment_status=derive_payment_status(amount_paid, total),
        date=date or timezone.now().date(),
        notes=notes,
        user=user,
    )

    PurchaseItem.objects.bulk_create(
        [
            PurchaseItem(
                purchase=purchase,
                product=product,
                quantity=quantity,
                unit_cost=unit_cost,
                line_total=line_total,
            )
            for (product, quantity, unit_cost, line_total) in rows
        ]
    )

    # Stock in: one +qty ledger row per line, in this same transaction.
    for product, quantity, unit_cost, _lt in rows:
        record_transaction(
            product=product,
            quantity=quantity,
            type=InventoryTransaction.Type.PURCHASE,
            user=user,
            unit_cost=unit_cost,
            reference_type="purchase",
            reference_id=str(purchase.id),
        )

    if supplier is not None:
        recompute_supplier_payable(supplier)

    return purchase
