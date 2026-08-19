"""Correcting a sale that was recorded wrong (owner-only).

Why an edit and not just a void
-------------------------------
Void and edit answer different questions:

* **Void** — the sale never happened. Reverse it entirely.
* **Edit** — the sale happened, but what was typed in does not match it: three
  units rang up instead of two, cash recorded when it was Telebirr, the wrong
  day, the wrong customer.

Without an edit the only fix is void-and-re-enter, which leaves a phantom
voided sale behind and loses the link between the mistake and the correction.

How it stays safe
-----------------
A sale is money that has already been reported on, so a correction is a
first-class, permanent event rather than a quiet overwrite:

* **Owner-only**, enforced in the viewset.
* **A reason is required.** A money edit with no stated cause is exactly what an
  audit trail exists to prevent.
* **Every change is recorded.** ``SaleAmendment`` stores full before/after
  snapshots plus a human-readable diff, append-only, and the activity log gets a
  ``warn`` row. Nothing is lost — the original figures stay readable forever.
* **Stock moves by the net delta only** (the same rule purchases use), so a
  metadata-only edit touches no stock, and a correction that would drive a
  product below zero is refused and rolled back.
* **Totals are always recomputed server-side** from the submitted lines. The
  client never states a total.
* **A voided sale cannot be edited** — there is nothing meaningful to correct in
  a reversed record.
* **The date obeys the same backdating policy** as a new sale (past-only,
  bounded, owner-only) — see ``apps.sales.backdating``.
"""

from __future__ import annotations

from django.db import models, transaction
from django.utils import timezone

from apps.inventory.models import InventoryTransaction
from apps.inventory.services import NegativeStockError, record_transaction

from .models import Payment, Sale, SaleAmendment, SaleItem
from .services import CheckoutError, InsufficientStockError


class SaleNotEditable(CheckoutError):
    """The sale is in a state where correcting it makes no sense (e.g. voided)."""


def snapshot(sale: Sale) -> dict:
    """A complete, self-contained picture of a sale for the audit record.

    Reads the line and payment rows straight from the DB rather than through
    ``sale.items`` / ``sale.payments``: the viewset prefetches both, and a
    prefetch cache would hand back the pre-edit rows for the *after* snapshot.
    """
    items = SaleItem.objects.filter(sale=sale).order_by("created_at")
    payments = Payment.objects.filter(sale=sale).order_by("received_at")
    return {
        "occurred_at": sale.occurred_at.isoformat(),
        "subtotal": sale.subtotal,
        "discount": sale.discount,
        "tax": sale.tax,
        "total": sale.total,
        "notes": sale.notes,
        "customer_id": str(sale.customer_id) if sale.customer_id else None,
        "customer_name": sale.customer.name if sale.customer_id else None,
        "items": [
            {
                "product_id": str(i.product_id),
                "name": i.name_snapshot,
                "sku": i.sku_snapshot,
                "quantity": i.quantity,
                "unit_price": i.unit_price_snapshot,
                "line_total": i.line_total,
            }
            for i in items
        ],
        "payments": [{"method": p.method, "amount": p.amount} for p in payments],
    }


def _money(value: int) -> str:
    """Minor units as a plain decimal string — the diff is read by people, and
    the shop's currency symbol is added by whatever renders it."""
    return f"{value / 100:.2f}"


def _describe_items(items: list[dict]) -> str:
    return "; ".join(f"{i['quantity']} × {i['name']} @ {_money(i['unit_price'])}" for i in items)


def _describe_payments(payments: list[dict]) -> str:
    return "; ".join(f"{p['method']} {_money(p['amount'])}" for p in payments) or "none"


def diff(before: dict, after: dict) -> list[dict]:
    """A human-readable list of what actually changed. Empty when nothing did."""
    changes: list[dict] = []

    def add(field, old, new):
        if old != new:
            changes.append({"field": field, "from": str(old), "to": str(new)})

    add(
        "Sale date",
        before["occurred_at"][:10],
        after["occurred_at"][:10],
    )
    add("Customer", before["customer_name"] or "Walk-in", after["customer_name"] or "Walk-in")
    add("Items", _describe_items(before["items"]), _describe_items(after["items"]))
    add("Discount", _money(before["discount"]), _money(after["discount"]))
    add("Tax", _money(before["tax"]), _money(after["tax"]))
    add("Total", _money(before["total"]), _money(after["total"]))
    add("Payments", _describe_payments(before["payments"]), _describe_payments(after["payments"]))
    add("Notes", before["notes"] or "—", after["notes"] or "—")
    return changes


def _quantities(rows) -> dict:
    """Units per product id across a list of (product, quantity) pairs."""
    totals: dict = {}
    for product, quantity in rows:
        totals[product.id] = totals.get(product.id, 0) + quantity
    return totals


@transaction.atomic
def amend_sale(*, sale: Sale, user, reason: str, validated: dict) -> tuple[Sale, SaleAmendment]:
    """Apply an owner's correction to ``sale`` and record it permanently.

    ``validated`` is a partial edit: only the keys present are changed. Passing
    ``items`` or ``payments`` replaces that list wholesale — a partial edit of a
    money list has no unambiguous meaning.

    Returns ``(sale, amendment)``. Raises ``SaleNotEditable`` for a voided sale
    and ``InsufficientStockError`` when the correction would oversell.
    """
    # Serialise concurrent corrections of the same sale. Two owners editing at
    # once would otherwise each snapshot a `before` that ignores the other, and
    # the later write would silently drop the earlier correction while still
    # recording it as applied. (A no-op on SQLite, like the lock in checkout;
    # the ledger's conditional update still keeps stock from going negative.)
    sale = Sale.objects.select_for_update().get(pk=sale.pk)

    if sale.status == Sale.Status.VOIDED:
        raise SaleNotEditable("A voided sale cannot be edited. Record a new sale instead.")

    before = snapshot(sale)
    old_customer = sale.customer

    # ---------------------------------------------------------------- lines
    if "items" in validated:
        # Keep the product objects for both sides so the ledger can be moved by
        # the net difference per product — a line whose quantity did not change
        # writes no ledger row at all.
        old_rows = [(row.product, row.quantity) for row in sale.items.select_related("product")]
        new_rows = [(item["product"], item["quantity"]) for item in validated["items"]]
        products = {p.id: p for p, _ in old_rows}
        products.update({p.id: p for p, _ in new_rows})

        old_qty = _quantities(old_rows)
        new_qty = _quantities(new_rows)

        for product_id in set(old_qty) | set(new_qty):
            # Positive delta = more units sold now = stock must come OUT, hence
            # the negative sign on the ledger row.
            delta = new_qty.get(product_id, 0) - old_qty.get(product_id, 0)
            if delta == 0:
                continue
            product = products[product_id]
            try:
                record_transaction(
                    product=product,
                    quantity=-delta,
                    type=InventoryTransaction.Type.ADJUSTMENT,
                    user=user,
                    reference_type="sale_edit",
                    reference_id=str(sale.id),
                    notes=f"Sale corrected: {reason}"[:500],
                )
            except NegativeStockError as exc:
                # Raising the same structured error checkout uses means the POS
                # already knows how to point at the offending line.
                raise InsufficientStockError(
                    {
                        str(product.pk): {
                            "name": product.name,
                            "sku": product.sku,
                            "requested": exc.requested,
                            "available": exc.available,
                        }
                    }
                ) from exc

        # Replace the line rows, re-snapshotting name/sku/price as at the edit.
        sale.items.all().delete()
        subtotal = 0
        rows = []
        for item in validated["items"]:
            product = item["product"]
            quantity = item["quantity"]
            unit_price = item.get("unit_price")
            if unit_price is None:
                unit_price = product.selling_price
            line_total = unit_price * quantity
            subtotal += line_total
            rows.append(
                SaleItem(
                    sale=sale,
                    product=product,
                    name_snapshot=product.name,
                    sku_snapshot=product.sku,
                    unit_price_snapshot=unit_price,
                    quantity=quantity,
                    line_total=line_total,
                )
            )
        SaleItem.objects.bulk_create(rows)
        sale.subtotal = subtotal

    # ---------------------------------------------------------------- header
    if "occurred_at" in validated and validated["occurred_at"] is not None:
        sale.occurred_at = validated["occurred_at"]
    if "customer" in validated:
        sale.customer = validated["customer"]
    if "discount" in validated:
        sale.discount = validated["discount"]
    if "tax" in validated:
        sale.tax = validated["tax"]
    if "notes" in validated:
        sale.notes = validated["notes"]

    # Never trust a client total — always derived from the stored lines.
    sale.total = sale.subtotal - sale.discount + sale.tax
    if sale.total < 0:
        raise CheckoutError("Total cannot be negative.")

    # ---------------------------------------------------------------- money
    if "payments" in validated:
        sale.payments.all().delete()
        Payment.objects.bulk_create(
            [
                Payment(
                    shop=sale.shop,
                    sale=sale,
                    customer=sale.customer,
                    method=p["method"],
                    amount=p["amount"],
                    user=user,
                    # Money follows the sale's day, so the day still reconciles.
                    received_at=sale.occurred_at,
                )
                for p in validated["payments"]
            ]
        )
    else:
        # The lines or the date may have moved under existing payments; keep
        # them attached to the right customer and the right day.
        sale.payments.all().update(customer=sale.customer, received_at=sale.occurred_at)

    paid = Payment.objects.filter(sale=sale).aggregate(models.Sum("amount"))["amount__sum"] or 0
    if paid < sale.total and sale.customer is None:
        # Same rule as checkout: a shortfall is credit, and credit needs someone
        # to owe it.
        raise CheckoutError(
            "Payments do not cover the sale total. Attach a customer to leave the "
            "difference on credit."
        )

    sale.amended_at = timezone.now()
    sale.amended_by = user
    sale.save(
        update_fields=[
            "subtotal",
            "discount",
            "tax",
            "total",
            "notes",
            "customer",
            "occurred_at",
            "amended_at",
            "amended_by",
            "updated_at",
        ]
    )

    after = snapshot(sale)
    amendment = SaleAmendment.objects.create(
        sale=sale,
        user=user,
        reason=reason,
        before=before,
        after=after,
        changes=diff(before, after),
    )

    # Both the old and the new customer's credit may have shifted.
    from apps.customers.services import recompute_customer_balance

    for customer in {old_customer, sale.customer}:
        if customer is not None:
            recompute_customer_balance(customer)

    return sale, amendment
