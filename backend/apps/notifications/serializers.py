from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    is_read = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = ["id", "type", "level", "title", "payload", "read_at", "is_read", "created_at"]
        read_only_fields = fields

    def get_is_read(self, notification) -> bool:
        return notification.read_at is not None
