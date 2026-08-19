from django.contrib import admin

from apps.common.admin import money_column

from .models import Payment, Sale, SaleItem


class SaleItemInline(admin.TabularInline):
    model = SaleItem
    extra = 0
    can_delete = False
    unit_price = money_column("unit_price_snapshot", "Unit price")
    total = money_column("line_total", "Line total")
    readonly_fields = ["product", "name_snapshot", "unit_price", "quantity", "total"]
    fields = readonly_fields

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("product", "sale__shop__settings")


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0
    can_delete = False
    paid = money_column("amount", "Amount")
    readonly_fields = ["method", "paid", "received_at", "user"]
    fields = readonly_fields

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("user", "shop__settings")


@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    # Both dates: `occurred_at` is the day booked, `created_at` the day entered.
    # Seeing them side by side is how a backdated sale is spotted at a glance.
    amount = money_column("total", "Total")
    sub = money_column("subtotal", "Subtotal")
    off = money_column("discount", "Discount")
    vat = money_column("tax", "Tax")

    list_display = ["id", "shop", "cashier", "amount", "status", "occurred_at", "created_at"]
    list_filter = ["status", "occurred_at"]
    search_fields = ["id", "client_uuid"]
    list_select_related = ["shop", "shop__settings", "cashier"]
    inlines = [SaleItemInline, PaymentInline]

    # A sale is never editable here (see below), so Django renders this form
    # entirely read-only — which means the money form field never gets a look in
    # and the raw integers would show. These are the formatted stand-ins.
    fields = [
        "shop",
        "client_uuid",
        "cashier",
        "customer",
        "sub",
        "off",
        "vat",
        "amount",
        "status",
        "occurred_at",
        "created_at",
        "notes",
        "amended_at",
        "amended_by",
        "voided_at",
        "voided_by",
    ]
    readonly_fields = fields

    def get_queryset(self, request):
        # The currency each figure is rendered in comes from the shop's settings.
        return super().get_queryset(request).select_related("shop__settings")

    def has_change_permission(self, request, obj=None):
        return False
