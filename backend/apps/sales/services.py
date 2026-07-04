"""Sales checkout & void (plan §3.4, §3.6, §12).

Thin views, fat services: all the money + ledger logic lives here, wrapped in a
single DB transaction. Totals are always recomputed server-side from line items —
never trusted from the client.
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.inventory.models import InventoryTransaction
from apps.inventory.services import record_transaction

from .models import Payment, Sale, SaleItem


class CheckoutError(Exception):
    """Raised for unrecoverable checkout problems (e.g. underpayment)."""


def _build_sale(
    *, shop, cashier, client_uuid, items, payments, discount, tax, notes, customer=None
) -> Sale:
    subtotal = 0
    line_rows = []
    for item in items:
        product = item["product"]
        quantity = item["quantity"]
        # Snapshot the price charged at sale time; fall back to the current price.
        unit_price = item.get("unit_price")
        if unit_price is None:
            unit_price = product.selling_price
        line_total = unit_price * quantity
        subtotal += line_total
        line_rows.append((product, quantity, unit_price, line_total))

    total = subtotal - discount + tax
    if total < 0:
        raise CheckoutError("Total cannot be negative.")

    paid = sum(p["amount"] for p in payments)
    if paid < total and customer is None:
        # Underpayment is only allowed as credit, which requires a customer.
        raise CheckoutError("Payments do not cover the sale total (no customer for credit).")

    sale = Sale.objects.create(
        shop=shop,
        client_uuid=client_uuid,
        cashier=cashier,
        customer=customer,
        subtotal=subtotal,
        discount=discount,
        tax=tax,
        total=total,
        notes=notes,
    )

    SaleItem.objects.bulk_create(
        [
            SaleItem(
                sale=sale,
                product=product,
                name_snapshot=product.name,
                sku_snapshot=product.sku,
                unit_price_snapshot=unit_price,
                quantity=quantity,
                line_total=line_total,
            )
            for (product, quantity, unit_price, line_total) in line_rows
        ]
    )

    Payment.objects.bulk_create(
        [
            Payment(
                shop=shop,
                sale=sale,
                customer=customer,
                method=p["method"],
                amount=p["amount"],
                user=cashier,
            )
            for p in payments
        ]
    )

    # Decrement stock through the ledger (one row per line), then check low stock.
    from apps.notifications.services import notify_low_stock

    for product, quantity, _unit_price, _lt in line_rows:
        record_transaction(
            product=product,
            quantity=-quantity,
            type=InventoryTransaction.Type.SALE,
            user=cashier,
            reference_type="sale",
            reference_id=str(sale.id),
        )
        notify_low_stock(product)

    return sale


def create_sale(
    *, shop, cashier, client_uuid, items, payments, discount=0, tax=0, notes="", customer=None
) -> tuple[Sale, bool]:
    """Idempotent checkout. Returns (sale, created). A replay of the same
    ``client_uuid`` returns the original sale with created=False (plan §3.4)."""
    existing = Sale.objects.filter(client_uuid=client_uuid).first()
    if existing is not None:
        return existing, False

    try:
        with transaction.atomic():
            sale = _build_sale(
                shop=shop,
                cashier=cashier,
                client_uuid=client_uuid,
                items=items,
                payments=payments,
                discount=discount,
                tax=tax,
                notes=notes,
                customer=customer,
            )
            if customer is not None:
                from apps.customers.services import recompute_customer_balance

                recompute_customer_balance(customer)
        return sale, True
    except IntegrityError:
        # A concurrent request with the same client_uuid won the race.
        return Sale.objects.get(client_uuid=client_uuid), False


@transaction.atomic
def void_sale(sale: Sale, *, user) -> Sale:
    """Reverse a completed sale's stock effects via compensating ledger rows and
    mark it voided (plan §3.6). Idempotent: voiding a voided sale is a no-op."""
    if sale.status == Sale.Status.VOIDED:
        return sale

    for item in sale.items.select_related("product"):
        record_transaction(
            product=item.product,
            quantity=item.quantity,  # add the sold units back
            type=InventoryTransaction.Type.ADJUSTMENT,
            user=user,
            reference_type="sale_void",
            reference_id=str(sale.id),
            notes=f"Reversal of voided sale {sale.id}",
        )

    sale.status = Sale.Status.VOIDED
    sale.voided_at = timezone.now()
    sale.voided_by = user
    sale.save(update_fields=["status", "voided_at", "voided_by", "updated_at"])

    if sale.customer_id is not None:
        from apps.customers.services import recompute_customer_balance

        recompute_customer_balance(sale.customer)

    from apps.notifications.services import notify_large_void

    notify_large_void(sale)
    return sale
