from django.contrib import admin

from .models import Customer


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ["name", "shop", "phone", "credit_balance_cached"]
    search_fields = ["name", "phone"]
    list_select_related = ["shop"]
