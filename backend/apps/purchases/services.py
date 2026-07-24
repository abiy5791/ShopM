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


def _line_quantities(items) -> dict:
    """Aggregate quantity per product id across a list of item dicts/rows."""
    totals: dict = {}
    for item in items:
        product = item["product"]
        totals[product.id] = totals.get(product.id, 0) + item["quantity"]
    return totals


@transaction.atomic
def update_purchase(*, purchase, user, validated) -> Purchase:
    """Edit a purchase. When the item lines change, only the net per-product
    stock delta is written to the ledger (append-only, plan §3.2), so a
    metadata-only edit touches no stock and a decreasing edit is blocked if the
    units were already sold (NegativeStockError bubbles up and rolls back)."""
    old_supplier = purchase.supplier

    if "items" in validated:
        new_items = validated["items"]
        old_by_product = {}
        for row in purchase.items.select_related("product"):
            old_by_product.setdefault(row.product_id, row.product)
        product_by_id = dict(old_by_product)
        for item in new_items:
            product_by_id[item["product"].id] = item["product"]

        old_qty = _line_quantities(
            [{"product": row.product, "quantity": row.quantity} for row in purchase.items.all()]
        )
        new_qty = _line_quantities(new_items)

        # Apply only the net change per product, in this same transaction.
        for product_id in set(old_qty) | set(new_qty):
            delta = new_qty.get(product_id, 0) - old_qty.get(product_id, 0)
            if delta != 0:
                record_transaction(
                    product=product_by_id[product_id],
                    quantity=delta,
                    type=InventoryTransaction.Type.ADJUSTMENT,
                    user=user,
                    reference_type="purchase_edit",
                    reference_id=str(purchase.id),
                    notes="Purchase edited",
                )

        # Replace the line rows and recompute the total.
        purchase.items.all().delete()
        total = 0
        rows = []
        for item in new_items:
            line_total = item["unit_cost"] * item["quantity"]
            total += line_total
            rows.append(
                PurchaseItem(
                    purchase=purchase,
                    product=item["product"],
                    quantity=item["quantity"],
                    unit_cost=item["unit_cost"],
                    line_total=line_total,
                )
            )
        PurchaseItem.objects.bulk_create(rows)
        purchase.total = total

    if "supplier" in validated:
        purchase.supplier = validated["supplier"]
    if "amount_paid" in validated:
        purchase.amount_paid = validated["amount_paid"]
    if validated.get("date"):
        purchase.date = validated["date"]
    if "notes" in validated:
        purchase.notes = validated["notes"]

    purchase.payment_status = derive_payment_status(purchase.amount_paid, purchase.total)
    purchase.save()

    # Both the old and new supplier's payable may have shifted.
    for supplier in {old_supplier, purchase.supplier}:
        if supplier is not None:
            recompute_supplier_payable(supplier)

    return purchase


@transaction.atomic
def delete_purchase(*, purchase, user) -> None:
    """Delete a purchase, reversing its stock-in with compensating ledger rows.
    Blocked (NegativeStockError) if reversing would drive any product below zero
    — i.e. the purchased units were already sold."""
    supplier = purchase.supplier

    for row in purchase.items.select_related("product"):
        record_transaction(
            product=row.product,
            quantity=-row.quantity,
            type=InventoryTransaction.Type.ADJUSTMENT,
            user=user,
            unit_cost=row.unit_cost,
            reference_type="purchase_void",
            reference_id=str(purchase.id),
            notes="Purchase deleted",
        )

    purchase.delete()  # cascades the PurchaseItem rows; ledger rows are kept

    if supplier is not None:
        recompute_supplier_payable(supplier)
