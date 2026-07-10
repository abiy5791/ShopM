"""Demo data for a **boutique** (clothing store): 1 owner, 2 branches, a cashier
each, a fashion catalog with opening stock, customers, real sales history (rung
through the ledger so stock/reports/dashboard all populate), and expenses.

Ethiopian context — money is in santim (100 santim = 1 Birr). Idempotent: safe to
re-run; use `manage.py flush` first if you want a clean rebuild.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from django.conf import settings as django_settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Role
from apps.activity.services import log_activity
from apps.catalog.models import Category, Product, Supplier
from apps.customers.models import Customer
from apps.expenses.models import Expense, ExpenseCategory
from apps.inventory.models import InventoryTransaction
from apps.inventory.services import record_transaction
from apps.sales.models import Payment
from apps.sales.services import create_sale
from apps.shops.models import Shop, ShopMembership, ShopSettings

User = get_user_model()

DEMO_PASSWORD = "password123"

EXPENSE_CATEGORIES = [
    "Rent",
    "Salary",
    "Electricity",
    "Internet",
    "Transport",
    "Marketing",
    "Maintenance",
    "Misc",
]

# Boutique suppliers (name -> phone).
SUPPLIERS = {
    "Dubai Fashion Imports": "+251911000010",
    "Addis Garment Factory": "+251911000011",
    "Merkato Textiles": "+251911000012",
}

# Which supplier stocks which category.
CATEGORY_SUPPLIER = {
    "Women's Wear": "Dubai Fashion Imports",
    "Kids": "Dubai Fashion Imports",
    "Men's Wear": "Addis Garment Factory",
    "Shoes": "Addis Garment Factory",
    "Traditional": "Merkato Textiles",
    "Bags & Accessories": "Merkato Textiles",
}

# (name, category, sku, purchase_price, selling_price, min_alert, opening_stock)
# Prices are in santim; 100 santim = 1 Birr, so 120000 = Br 1,200.00.
DEMO_PRODUCTS = [
    # Women's Wear
    ("Casual Summer Dress", "Women's Wear", "WMN-001", 70000, 120000, 5, 18),
    ("Elegant Blouse", "Women's Wear", "WMN-002", 38000, 65000, 5, 25),
    ("Slim-Fit Jeans (Women)", "Women's Wear", "WMN-003", 52000, 90000, 5, 20),
    ("Pleated Skirt", "Women's Wear", "WMN-004", 30000, 55000, 5, 15),
    ("Long Abaya", "Women's Wear", "WMN-005", 85000, 150000, 4, 12),
    ("Knit Cardigan", "Women's Wear", "WMN-006", 55000, 95000, 5, 3),  # low stock
    # Men's Wear
    ("Cotton T-Shirt", "Men's Wear", "MEN-001", 22000, 45000, 8, 40),
    ("Formal Shirt", "Men's Wear", "MEN-002", 48000, 85000, 6, 22),
    ("Slim-Fit Jeans (Men)", "Men's Wear", "MEN-003", 62000, 110000, 5, 18),
    ("2-Piece Suit", "Men's Wear", "MEN-004", 260000, 450000, 3, 6),
    ("Pullover Hoodie", "Men's Wear", "MEN-005", 55000, 95000, 5, 14),
    ("Chino Trousers", "Men's Wear", "MEN-006", 45000, 80000, 5, 2),  # low stock
    # Traditional
    ("Habesha Kemis (Women)", "Traditional", "TRD-001", 200000, 350000, 3, 10),
    ("Netela Shawl", "Traditional", "TRD-002", 45000, 80000, 5, 20),
    ("Men's Habesha Shirt", "Traditional", "TRD-003", 70000, 120000, 4, 12),
    ("Kids Habesha Set", "Traditional", "TRD-004", 60000, 105000, 4, 8),
    # Kids
    ("Kids T-Shirt", "Kids", "KID-001", 15000, 30000, 8, 35),
    ("Kids Party Dress", "Kids", "KID-002", 30000, 55000, 5, 16),
    ("Kids Denim Jacket", "Kids", "KID-003", 40000, 70000, 5, 10),
    # Shoes
    ("Women's Heels", "Shoes", "SHO-001", 75000, 130000, 4, 12),
    ("Men's Loafers", "Shoes", "SHO-002", 95000, 160000, 4, 10),
    ("Sneakers (Unisex)", "Shoes", "SHO-003", 105000, 180000, 5, 15),
    ("Leather Sandals", "Shoes", "SHO-004", 28000, 50000, 6, 24),
    # Bags & Accessories
    ("Leather Handbag", "Bags & Accessories", "ACC-001", 80000, 140000, 4, 14),
    ("Bifold Wallet", "Bags & Accessories", "ACC-002", 20000, 40000, 8, 30),
    ("Leather Belt", "Bags & Accessories", "ACC-003", 18000, 35000, 8, 28),
    ("Sunglasses", "Bags & Accessories", "ACC-004", 32000, 60000, 6, 20),
    ("Silk Scarf", "Bags & Accessories", "ACC-005", 15000, 30000, 8, 4),  # low stock
]

# (name, phone) — repeat customers of the boutique.
DEMO_CUSTOMERS = [
    ("Hanna Girma", "+251912345678"),
    ("Yohannes Tadesse", "+251913456789"),
    ("Meron Haile", "+251914567890"),
    ("Bereket Assefa", "+251915678901"),
    ("Selam Negash", "+251916789012"),
]

# (lines[(sku, qty)], method, days_ago, customer_index|None, pay_ratio)
# pay_ratio < 1 with a customer = a credit sale; the balance becomes their debt.
DEMO_SALES = [
    ([("MEN-001", 2), ("ACC-003", 1)], "cash", 0, None, 1.0),
    ([("WMN-001", 1), ("SHO-001", 1)], "mobile_money", 0, None, 1.0),
    ([("WMN-003", 2)], "cash", 0, None, 1.0),
    ([("SHO-003", 1)], "bank", 1, 1, 1.0),  # Yohannes — paid in full
    ([("TRD-001", 1), ("TRD-002", 2)], "cash", 2, None, 1.0),
    ([("MEN-004", 1)], "bank", 3, 0, 0.5),  # Hanna — suit on credit (50% down)
    ([("KID-001", 3), ("KID-002", 1)], "cash", 5, None, 1.0),
    ([("ACC-001", 1), ("ACC-004", 1)], "mobile_money", 8, None, 1.0),
]

# (category, amount_santim, days_ago, description)
DEMO_EXPENSES = [
    ("Rent", 1500000, 6, "Monthly shop rent"),
    ("Salary", 1600000, 4, "Staff salaries"),
    ("Electricity", 120000, 3, "EEU electricity bill"),
    ("Internet", 90000, 3, "Ethio Telecom internet"),
    ("Marketing", 250000, 2, "Instagram promotion"),
    ("Transport", 60000, 1, "Stock transport from Merkato"),
]


class Command(BaseCommand):
    help = "Seed a demo boutique (owner, 2 branches, catalog, customers, sales, expenses)."

    @transaction.atomic
    def handle(self, *args, **options):
        owner_role, _ = Role.objects.get_or_create(name=Role.Name.OWNER)
        cashier_role, _ = Role.objects.get_or_create(name=Role.Name.CASHIER)

        owner = self._user("owner@shopm.local", "Abebe Kebede")
        currency = django_settings.DEFAULT_CURRENCY

        specs = [
            ("Fenet Boutique (Bole)", "Bole, Addis Ababa", "cashier.a@shopm.local", "Sara Alemu"),
            (
                "Fenet Boutique (Piassa)",
                "Piassa, Addis Ababa",
                "cashier.b@shopm.local",
                "Dawit Bekele",
            ),
        ]

        for shop_name, address, cashier_email, cashier_name in specs:
            shop, _ = Shop.objects.get_or_create(
                name=shop_name,
                owner=owner,
                defaults={"address": address, "phone": "+251911000000"},
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

            for name in EXPENSE_CATEGORIES:
                ExpenseCategory.objects.get_or_create(shop=shop, name=name)

            products = self._seed_catalog(shop, owner)
            customers = self._seed_customers(shop)
            self._seed_sales(shop, cashier, products, customers)
            self._seed_expenses(shop, owner)

        self.stdout.write(self.style.SUCCESS("Boutique seed complete."))
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

    def _seed_catalog(self, shop, owner) -> dict[str, Product]:
        suppliers = {
            name: Supplier.objects.get_or_create(shop=shop, name=name, defaults={"phone": phone})[0]
            for name, phone in SUPPLIERS.items()
        }
        products: dict[str, Product] = {}
        for name, cat_name, sku, cost, price, min_alert, opening in DEMO_PRODUCTS:
            category, _ = Category.objects.get_or_create(shop=shop, name=cat_name)
            supplier = suppliers[CATEGORY_SUPPLIER[cat_name]]
            product, created = Product.objects.get_or_create(
                shop=shop,
                sku=sku,
                defaults={
                    "name": name,
                    "category": category,
                    "supplier": supplier,
                    "purchase_price": cost,
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
            products[sku] = product
        return products

    def _seed_customers(self, shop) -> list[Customer]:
        return [
            Customer.objects.get_or_create(shop=shop, name=name, defaults={"phone": phone})[0]
            for name, phone in DEMO_CUSTOMERS
        ]

    def _seed_sales(self, shop, cashier, products, customers) -> None:
        for index, (lines, method, days_ago, cust_idx, ratio) in enumerate(DEMO_SALES):
            items = [
                {
                    "product": products[sku],
                    "quantity": qty,
                    "unit_price": products[sku].selling_price,
                }
                for sku, qty in lines
            ]
            subtotal = sum(i["unit_price"] * i["quantity"] for i in items)
            customer = customers[cust_idx] if cust_idx is not None else None
            paid = int(subtotal * ratio)
            payments = [{"method": method, "amount": paid}] if paid > 0 else []

            # Deterministic UUID -> re-running seed replays the same sale (no dupes).
            client_uuid = uuid.uuid5(uuid.NAMESPACE_URL, f"{shop.id}:sale:{index}")
            sale, created = create_sale(
                shop=shop,
                cashier=cashier,
                client_uuid=client_uuid,
                items=items,
                payments=payments,
                customer=customer,
            )
            # Spread history across the month so reports/charts aren't flat.
            if created and days_ago:
                when = timezone.now() - timedelta(days=days_ago)
                sale.__class__.objects.filter(pk=sale.pk).update(created_at=when)
                Payment.objects.filter(sale=sale).update(received_at=when)

    def _seed_expenses(self, shop, owner) -> None:
        for cat_name, amount, days_ago, description in DEMO_EXPENSES:
            category = ExpenseCategory.objects.filter(shop=shop, name=cat_name).first()
            Expense.objects.get_or_create(
                shop=shop,
                description=description,
                defaults={
                    "category": category,
                    "amount": amount,
                    "date": timezone.localdate() - timedelta(days=days_ago),
                    "user": owner,
                },
            )
