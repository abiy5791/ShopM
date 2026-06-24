from django.contrib import admin

from .models import Purchase, PurchaseItem


class PurchaseItemInline(admin.TabularInline):
    model = PurchaseItem
    extra = 0
    readonly_fields = ["product", "quantity", "unit_cost", "line_total"]


@admin.register(Purchase)
class PurchaseAdmin(admin.ModelAdmin):
    list_display = ["id", "shop", "supplier", "total", "payment_status", "date"]
    list_filter = ["payment_status"]
    list_select_related = ["shop", "supplier"]
    inlines = [PurchaseItemInline]
