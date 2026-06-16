from django.contrib import admin

from .models import Shop, ShopMembership, ShopSettings


@admin.register(Shop)
class ShopAdmin(admin.ModelAdmin):
    list_display = ["name", "owner", "phone", "deleted_at"]
    search_fields = ["name", "phone"]


@admin.register(ShopMembership)
class ShopMembershipAdmin(admin.ModelAdmin):
    list_display = ["user", "shop", "role"]
    list_select_related = ["user", "shop", "role"]


@admin.register(ShopSettings)
class ShopSettingsAdmin(admin.ModelAdmin):
    list_display = ["shop", "currency", "tax_rate"]
