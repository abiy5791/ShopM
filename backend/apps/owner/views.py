from datetime import date

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.activity.models import ActivityLog
from apps.activity.serializers import ActivityLogSerializer
from apps.common.permissions import IsOwner

from .services import compare_shops, owned_shops, owner_dashboard


def _parse_date(value):
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


class OwnerDashboardView(generics.GenericAPIView):
    """GET /owner/dashboard — aggregates across every shop the user owns.
    No X-Shop-Id; cashiers (non-owners) get 403 (plan §11 Phase 6)."""

    permission_classes = [IsAuthenticated, IsOwner]

    @extend_schema(responses={200: dict})
    def get(self, request, *args, **kwargs):
        return Response(owner_dashboard(request.user))


class OwnerCompareView(generics.GenericAPIView):
    """GET /owner/shops/compare — side-by-side performance, ranked by sales."""

    permission_classes = [IsAuthenticated, IsOwner]

    @extend_schema(
        parameters=[
            OpenApiParameter("start", str, description="YYYY-MM-DD"),
            OpenApiParameter("end", str, description="YYYY-MM-DD"),
        ],
        responses={200: dict},
    )
    def get(self, request, *args, **kwargs):
        return Response(
            compare_shops(
                request.user,
                start=_parse_date(request.query_params.get("start")),
                end=_parse_date(request.query_params.get("end")),
            )
        )


class OwnerActivityView(generics.ListAPIView):
    """GET /owner/activity — employee activity across all owned shops."""

    permission_classes = [IsAuthenticated, IsOwner]
    serializer_class = ActivityLogSerializer
    filterset_fields = ["action", "user", "level"]
    ordering_fields = ["created_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ActivityLog.objects.none()
        return (
            ActivityLog.objects.filter(shop__in=owned_shops(self.request.user))
            .select_related("user")
            .order_by("-created_at")
        )
