from django.contrib import admin

from .models import ActivityLog


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ["created_at", "action", "user", "shop", "level"]
    list_filter = ["level", "action"]
    search_fields = ["action", "entity_type", "entity_id"]
    list_select_related = ["user", "shop"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
