from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ReadOnlyModelViewSet

from apps.activity.services import log_activity
from apps.common.mixins import ShopScopedViewSetMixin
from apps.common.permissions import ROLE_OWNER, ActiveShopRolePermission
from apps.common.utils import get_client_ip

from .models import Shop, ShopMembership, ShopSettings
from .serializers import ShopSerializer, ShopSettingsSerializer


class ShopViewSet(ReadOnlyModelViewSet):
    """GET /shops — the shops the current user can access (not shop-scoped)."""

    serializer_class = ShopSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # schema generation
            return Shop.objects.none()
        user = self.request.user
        my_memberships = ShopMembership.objects.filter(user=user).select_related("role")
        return (
            Shop.objects.filter(memberships__user=user, deleted_at__isnull=True)
            .prefetch_related(Prefetch("memberships", queryset=my_memberships))
            .distinct()
            .order_by("name")
        )


class ShopSettingsView(ShopScopedViewSetMixin, generics.RetrieveUpdateAPIView):
    """GET/PATCH /settings — settings for the active shop. Owner only."""

    serializer_class = ShopSettingsSerializer
    queryset = ShopSettings.objects.all()
    permission_classes = [IsAuthenticated, ActiveShopRolePermission]
    required_roles = {ROLE_OWNER}
    http_method_names = ["get", "patch", "head", "options"]

    def get_object(self):
        return get_object_or_404(self.get_queryset())

    def perform_update(self, serializer):
        obj = serializer.save()
        log_activity(
            user=self.request.user,
            action="settings.update",
            entity_type="shop_settings",
            entity_id=obj.id,
            shop=self.active_shop,
            ip=get_client_ip(self.request),
            metadata={"changed": sorted(serializer.validated_data.keys())},
        )
