from django.contrib import admin

from .models import Expense, ExpenseCategory


@admin.register(ExpenseCategory)
class ExpenseCategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "shop"]
    list_select_related = ["shop"]


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ["date", "category", "amount", "shop", "deleted_at"]
    list_filter = ["category"]
    search_fields = ["description"]
    list_select_related = ["shop", "category"]
