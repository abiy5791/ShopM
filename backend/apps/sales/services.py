"""Sales checkout & void (plan §3.4, §3.6, §12).

Thin views, fat services: all the money + ledger logic lives here, wrapped in a
single DB transaction. Totals are always recomputed server-side from line items —
never trusted from the client.
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.catalog.models import Product
from apps.inventory.models import InventoryTransaction
from apps.inventory.services import NegativeStockError, record_transaction

from .models import Payment, Sale, SaleItem


class CheckoutError(Exception):
    """Raised for unrecoverable checkout problems (e.g. underpayment)."""


class InsufficientStockError(CheckoutError):
    """One or more sale lines request more units than the shop has in stock.

    ``shortages`` maps product id → {name, sku, requested, available} so the
    POS can show exactly which lines to fix.
    """

    def __init__(self, shortages: dict[str, dict]):
        self.shortages = shortages
        names = ", ".join(s["name"] for s in shortages.values())
        super().__init__(f"Insufficient stock: {names}.")


def _check_stock(items) -> dict:
    """Lock the sale's product rows and verify availability (plan v2 §2).

    ``select_for_update`` serialises racing sales of the same products on
    PostgreSQL (it is a no-op on SQLite, where the conditional-update floor in
    ``record_transaction`` still guarantees stock never goes negative).
    Returns the locked product instances keyed by pk so the rest of checkout
    works from fresh rows.
    """
    requested: dict = {}
    for item in items:
        pk = item["product"].pk
        requested[pk] = requested.get(pk, 0) + item["quantity"]

    locked = {p.pk: p for p in Product.objects.select_for_update().filter(pk__in=requested)}

    shortages: dict[str, dict] = {}
    for pk, quantity in requested.items():
        product = locked.get(pk)
        available = product.stock_cached if product is not None else 0
        if quantity > available:
            shortages[str(pk)] = {
                "name": product.name if product is not None else "Unknown product",
                "sku": product.sku if product is not None else "",
                "requested": quantity,
                "available": available,
            }
    if shortages:
        raise InsufficientStockError(shortages)
    return locked


def _build_sale(
    *,
    shop,
    cashier,
    client_uuid,
    items,
    payments,
    discount,
    tax,
    notes,
    customer=None,
    occurred_at=None,
) -> Sale:
    locked_products = _check_stock(items)
    # The business instant the sale is booked to. Defaults to now; an owner
    # recording a missed day passes an earlier one (apps.sales.backdating).
    occurred_at = occurred_at or timezone.now()

    subtotal = 0
    line_rows = []
    for item in items:
        product = locked_products[item["product"].pk]
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
        occurred_at=occurred_at,
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
                # Money for a backdated sale came in on that day, not today, or
                # the day's takings would not reconcile with the day's sales.
                received_at=occurred_at,
            )
            for p in payments
        ]
    )

    # Decrement stock through the ledger (one row per line), then check low stock.
    # Stock is NOT backdated — the ledger is an append-only record of when the
    # system learned units were gone. The note says which day they left.
    from apps.notifications.services import notify_low_stock

    ledger_note = (
        f"Sale backdated to {timezone.localdate(occurred_at).isoformat()}"
        if sale.is_backdated
        else ""
    )
    for product, quantity, _unit_price, _lt in line_rows:
        try:
            record_transaction(
                product=product,
                quantity=-quantity,
                type=InventoryTransaction.Type.SALE,
                user=cashier,
                reference_type="sale",
                reference_id=str(sale.id),
                notes=ledger_note,
            )
        except NegativeStockError as exc:
            # Backstop for backends without row locks (SQLite): a racing sale
            # won between our pre-check and this decrement.
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
        notify_low_stock(product)

    return sale


def create_sale(
    *,
    shop,
    cashier,
    client_uuid,
    items,
    payments,
    discount=0,
    tax=0,
    notes="",
    customer=None,
    occurred_at=None,
) -> tuple[Sale, bool]:
    """Idempotent checkout. Returns (sale, created). A replay of the same
    ``client_uuid`` returns the original sale with created=False (plan §3.4).

    ``occurred_at`` books the sale to a business instant other than now. The
    caller is responsible for having authorised and range-checked it — see
    ``apps.sales.backdating`` and the owner-only gate in the viewset."""
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
                occurred_at=occurred_at,
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
