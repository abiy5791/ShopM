from django.contrib import admin

from apps.common.admin import MoneyAdminMixin, money_column

from .models import Customer


@admin.register(Customer)
class CustomerAdmin(MoneyAdminMixin, admin.ModelAdmin):
    balance = money_column("credit_balance_cached", "Credit balance")

    list_display = ["name", "shop", "phone", "balance"]
    search_fields = ["name", "phone"]
    list_select_related = ["shop", "shop__settings"]
