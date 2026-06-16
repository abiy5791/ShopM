"""Demo data: 1 owner, 2 shops, a cashier per shop, settings, sample roles.

Idempotent — safe to run repeatedly. Catalog/products seeding is added in Phase 1.
"""

from django.conf import settings as django_settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.models import Role
from apps.activity.services import log_activity
from apps.shops.models import Shop, ShopMembership, ShopSettings

User = get_user_model()

DEMO_PASSWORD = "password123"


class Command(BaseCommand):
    help = "Seed demo data (owner, 2 shops, a cashier each)."

    @transaction.atomic
    def handle(self, *args, **options):
        owner_role, _ = Role.objects.get_or_create(name=Role.Name.OWNER)
        cashier_role, _ = Role.objects.get_or_create(name=Role.Name.CASHIER)

        owner = self._user("owner@shopm.local", "Olivia Owner")
        currency = django_settings.DEFAULT_CURRENCY

        specs = [
            ("Downtown Store", "12 Market Street", "cashier.a@shopm.local", "Casey Cashier A"),
            ("Riverside Store", "5 Riverside Ave", "cashier.b@shopm.local", "Cody Cashier B"),
        ]

        for shop_name, address, cashier_email, cashier_name in specs:
            shop, _ = Shop.objects.get_or_create(
                name=shop_name,
                owner=owner,
                defaults={"address": address, "phone": "+10000000000"},
            )
            ShopSettings.objects.get_or_create(
                shop=shop,
                defaults={"currency": currency, "low_stock_default": 5},
            )
            ShopMembership.objects.get_or_create(
                user=owner, shop=shop, defaults={"role": owner_role}
            )

            cashier = self._user(cashier_email, cashier_name)
            ShopMembership.objects.get_or_create(
                user=cashier, shop=shop, defaults={"role": cashier_role}
            )
            log_activity(
                user=owner,
                action="seed.shop_created",
                entity_type="shop",
                entity_id=shop.id,
                shop=shop,
                metadata={"name": shop.name},
            )

        self.stdout.write(self.style.SUCCESS("Seed complete."))
        self.stdout.write(f"  Owner:    owner@shopm.local / {DEMO_PASSWORD}")
        self.stdout.write(
            f"  Cashiers: cashier.a@shopm.local, cashier.b@shopm.local / {DEMO_PASSWORD}"
        )

    def _user(self, email: str, full_name: str):
        user, created = User.objects.get_or_create(email=email, defaults={"full_name": full_name})
        if created:
            user.set_password(DEMO_PASSWORD)
            user.save(update_fields=["password"])
        return user
