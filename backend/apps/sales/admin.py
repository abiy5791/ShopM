from django.contrib import admin

from .models import Payment, Sale, SaleItem


class SaleItemInline(admin.TabularInline):
    model = SaleItem
    extra = 0
    can_delete = False
    readonly_fields = ["product", "name_snapshot", "unit_price_snapshot", "quantity", "line_total"]


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0
    can_delete = False
    readonly_fields = ["method", "amount", "received_at", "user"]


@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    list_display = ["id", "shop", "cashier", "total", "status", "created_at"]
    list_filter = ["status"]
    search_fields = ["id", "client_uuid"]
    list_select_related = ["shop", "cashier"]
    inlines = [SaleItemInline, PaymentInline]

    def has_change_permission(self, request, obj=None):
        return False
