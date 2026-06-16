from rest_framework import serializers

from .models import ActivityLog


class ActivityLogSerializer(serializers.ModelSerializer):
    user_email = serializers.EmailField(source="user.email", read_only=True, default=None)

    class Meta:
        model = ActivityLog
        fields = [
            "id",
            "action",
            "entity_type",
            "entity_id",
            "level",
            "metadata",
            "ip",
            "user",
            "user_email",
            "created_at",
        ]
        read_only_fields = fields
