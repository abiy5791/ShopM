from django.contrib import admin

from apps.common.admin import money_column

from .models import InventoryTransaction


@admin.register(InventoryTransaction)
class InventoryTransactionAdmin(admin.ModelAdmin):
    cost = money_column("unit_cost", "Unit cost")

    list_display = ["created_at", "product", "type", "quantity", "cost", "shop", "user"]
    list_filter = ["type"]
    search_fields = ["product__name", "product__sku", "reference_id"]
    list_select_related = ["product", "shop", "shop__settings", "user"]

    # Never editable (see below), so the form renders read-only and the money
    # form field never applies — `cost` is the formatted stand-in for unit_cost.
    fields = [
        "shop",
        "product",
        "quantity",
        "type",
        "cost",
        "reference_type",
        "reference_id",
        "user",
        "notes",
        "created_at",
    ]
    readonly_fields = fields

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
