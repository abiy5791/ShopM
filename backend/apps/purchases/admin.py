from django.contrib import admin

from apps.common.admin import MoneyAdminMixin, money_column

from .models import Purchase, PurchaseItem


class PurchaseItemInline(admin.TabularInline):
    model = PurchaseItem
    extra = 0
    cost = money_column("unit_cost", "Unit cost")
    total = money_column("line_total", "Line total")
    readonly_fields = ["product", "quantity", "cost", "total"]
    fields = readonly_fields


@admin.register(Purchase)
class PurchaseAdmin(MoneyAdminMixin, admin.ModelAdmin):
    amount = money_column("total", "Total")
    paid = money_column("amount_paid", "Paid")

    list_display = ["id", "shop", "supplier", "amount", "paid", "payment_status", "date"]
    list_filter = ["payment_status"]
    list_select_related = ["shop", "shop__settings", "supplier"]
    inlines = [PurchaseItemInline]
