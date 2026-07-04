from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.common.mixins import ShopScopedViewSetMixin
from apps.common.permissions import ActiveShopRolePermission

from .models import Notification
from .serializers import NotificationSerializer


class NotificationViewSet(ShopScopedViewSetMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """GET /notifications for the active shop; mark read individually or all at once."""

    serializer_class = NotificationSerializer
    queryset = Notification.objects.all()
    permission_classes = [IsAuthenticated, ActiveShopRolePermission]
    filterset_fields = ["type", "level"]
    ordering_fields = ["created_at"]

    def get_queryset(self):
        return super().get_queryset().order_by("read_at", "-created_at")

    @extend_schema(request=None, responses={200: NotificationSerializer})
    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        notification = self.get_object()
        notification.mark_read()
        return Response(self.get_serializer(notification).data)

    @extend_schema(request=None, responses={200: dict})
    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        updated = self.get_queryset().filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response({"marked_read": updated})

    @extend_schema(responses={200: dict})
    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        count = self.get_queryset().filter(read_at__isnull=True).count()
        return Response({"unread": count})
