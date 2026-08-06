from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from apps.common.mixins import ShopScopedViewSetMixin
from apps.common.permissions import ROLE_OWNER, ActiveShopRolePermission
from apps.reports import summaries

from .filters import ActivityLogFilter
from .models import ActivityLog
from .serializers import ActivityLogSerializer


class ActivityLogViewSet(ShopScopedViewSetMixin, ReadOnlyModelViewSet):
    """GET /activity — audit trail for the active shop. Owners see everything;
    cashiers see only their own actions (plan §8)."""

    serializer_class = ActivityLogSerializer
    queryset = ActivityLog.objects.select_related("user").all()
    permission_classes = [IsAuthenticated, ActiveShopRolePermission]
    filterset_class = ActivityLogFilter
    search_fields = ["action", "entity_type"]
    ordering_fields = ["created_at", "action"]

    def get_queryset(self):
        qs = super().get_queryset()  # scoped to the active shop by the mixin
        if self.active_role != ROLE_OWNER:
            qs = qs.filter(user=self.request.user)
        return qs.order_by("-created_at")

    @extend_schema(
        responses={200: {"type": "object"}},
        description="KPI cards shown above the activity table. Counts the same "
        "rows the caller can list, so a cashier sees only their own.",
    )
    @action(detail=False, methods=["get"])
    def summary(self, request):
        return Response(summaries.activity_summary(self.active_shop, self.get_queryset()))
