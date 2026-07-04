from django_filters import rest_framework as filters

from .models import ActivityLog


class ActivityLogFilter(filters.FilterSet):
    created_after = filters.IsoDateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_before = filters.IsoDateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = ActivityLog
        fields = ["action", "user", "level", "created_after", "created_before"]
