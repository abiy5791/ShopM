"""Customer credit balance derivation (plan §3.3).

balance = Σ(completed credit-sale totals) − Σ(payments that aren't tied to a
voided sale). Voiding a sale removes both its total and its checkout payments,
so the balance can never go negative from a void.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import Q, Sum

from .models import Customer


def derived_balance(customer: Customer) -> int:
    from apps.sales.models import Payment, Sale

    owed = (
        Sale.objects.filter(customer=customer, status=Sale.Status.COMPLETED).aggregate(
            total=Sum("total")
        )["total"]
        or 0
    )
    paid = (
        Payment.objects.filter(customer=customer)
        .filter(Q(sale__isnull=True) | Q(sale__status=Sale.Status.COMPLETED))
        .aggregate(total=Sum("amount"))["total"]
        or 0
    )
    return owed - paid


@transaction.atomic
def recompute_customer_balance(customer: Customer) -> int:
    balance = derived_balance(customer)
    Customer.objects.filter(pk=customer.pk).update(credit_balance_cached=balance)
    return balance
