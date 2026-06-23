from django.contrib import admin

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
class ProductAdmin(admin.ModelAdmin):
    list_display = ["name", "sku", "shop", "selling_price", "stock_cached", "status", "deleted_at"]
    search_fields = ["name", "sku", "barcode"]
    list_filter = ["status"]
    list_select_related = ["shop", "category"]
