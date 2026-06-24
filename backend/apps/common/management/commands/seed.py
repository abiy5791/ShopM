"""Demo data: 1 owner, 2 shops, a cashier per shop, settings, a sample catalog
with opening stock recorded through the ledger.

Idempotent — safe to run repeatedly.
"""

from django.conf import settings as django_settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.models import Role
from apps.activity.services import log_activity
from apps.catalog.models import Category, Product, Supplier
from apps.expenses.models import ExpenseCategory
from apps.inventory.models import InventoryTransaction
from apps.inventory.services import record_transaction
from apps.shops.models import Shop, ShopMembership, ShopSettings

User = get_user_model()

DEMO_PASSWORD = "password123"

EXPENSE_CATEGORIES = [
    "Rent",
    "Salary",
    "Electricity",
    "Internet",
    "Transport",
    "Maintenance",
    "Misc",
]

# (name, category, sku, selling_price (minor units), min_alert, opening_stock)
DEMO_PRODUCTS = [
    ("Cola 500ml", "Beverages", "BEV-001", 150, 24, 120),
    ("Mineral Water 1L", "Beverages", "BEV-002", 100, 24, 8),  # low stock on purpose
    ("White Bread", "Bakery", "BAK-001", 250, 10, 40),
    ("Whole Milk 1L", "Dairy", "DAI-001", 220, 12, 30),
    ("AA Batteries (4pk)", "Household", "HOU-001", 600, 6, 15),
    ("Dish Soap 500ml", "Household", "HOU-002", 480, 6, 3),  # low stock on purpose
]


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

            self._seed_catalog(shop, owner)
            for name in EXPENSE_CATEGORIES:
                ExpenseCategory.objects.get_or_create(shop=shop, name=name)

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

    def _seed_catalog(self, shop, owner):
        supplier, _ = Supplier.objects.get_or_create(
            shop=shop, name="Acme Wholesale", defaults={"phone": "+10000000001"}
        )
        for name, cat_name, sku, price, min_alert, opening in DEMO_PRODUCTS:
            category, _ = Category.objects.get_or_create(shop=shop, name=cat_name)
            product, created = Product.objects.get_or_create(
                shop=shop,
                sku=sku,
                defaults={
                    "name": name,
                    "category": category,
                    "supplier": supplier,
                    "purchase_price": int(price * 0.6),
                    "selling_price": price,
                    "min_stock_alert": min_alert,
                },
            )
            # Record opening stock once, via the ledger (only for brand-new products).
            if created and opening and not product.inventory_transactions.exists():
                record_transaction(
                    product=product,
                    quantity=opening,
                    type=InventoryTransaction.Type.ADJUSTMENT,
                    user=owner,
                    notes="Opening stock (seed)",
                )
