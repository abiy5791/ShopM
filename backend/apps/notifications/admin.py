from django.contrib import admin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ["created_at", "type", "level", "title", "shop", "read_at"]
    list_filter = ["type", "level"]
    search_fields = ["title"]
    list_select_related = ["shop"]
