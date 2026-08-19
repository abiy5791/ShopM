from django.contrib import admin

from apps.common.admin import MoneyAdminMixin, money_column

from .models import Category, Product, Supplier


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "shop"]
    search_fields = ["name"]
    list_select_related = ["shop"]


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ["name", "shop", "phone"]
    search_fields = ["name", "phone"]
    list_select_related = ["shop"]


@admin.register(Product)
class ProductAdmin(MoneyAdminMixin, admin.ModelAdmin):
    # Prices are stored as integer minor units; these render them as money and
    # still sort on the raw column.
    cost = money_column("purchase_price", "Cost")
    price = money_column("selling_price", "Selling price")

    list_display = ["name", "sku", "shop", "cost", "price", "stock_cached", "status", "deleted_at"]
    search_fields = ["name", "sku", "barcode"]
    list_filter = ["status"]
    list_select_related = ["shop", "category"]
    actions = ["restore"]

    def get_queryset(self, request):
        # Show soft-deleted products too, so `deleted_at` is meaningful and a
        # delete can be undone from here.
        # `shop__settings` carries the currency each price is rendered in —
        # selected here so the list page stays one query, not one per row.
        return Product.all_objects.get_queryset().select_related(
            "shop", "shop__settings", "category"
        )

    def get_deleted_objects(self, objs, request):
        # Product is a SoftDeleteModel: deleting only stamps `deleted_at`, so
        # nothing cascades and no related row is touched. Django's default
        # collector walks the FK graph anyway and reaches the append-only
        # ledger (InventoryTransaction.product is PROTECT), whose admin
        # hard-codes has_delete_permission() -> False. That lands in
        # `perms_needed` and the confirmation page reports a bogus permission
        # error that not even a superuser can clear.
        return [str(obj) for obj in objs], {}, set(), []

    @admin.action(description="Restore selected products")
    def restore(self, request, queryset):
        restored = queryset.dead().update(deleted_at=None)
        self.message_user(request, f"Restored {restored} product(s).")
