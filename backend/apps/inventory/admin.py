from django.contrib import admin

from .models import InventoryTransaction


@admin.register(InventoryTransaction)
class InventoryTransactionAdmin(admin.ModelAdmin):
    list_display = ["created_at", "product", "type", "quantity", "shop", "user"]
    list_filter = ["type"]
    search_fields = ["product__name", "product__sku", "reference_id"]
    list_select_related = ["product", "shop", "user"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
