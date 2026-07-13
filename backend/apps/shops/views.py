from django.db import transaction
from django.db.models import Prefetch
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import generics, status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import Role
from apps.activity.services import log_activity
from apps.common.mixins import ShopScopedViewSetMixin
from apps.common.permissions import ROLE_OWNER, ActiveShopRolePermission, IsOwner
from apps.common.utils import get_client_ip

from .models import Shop, ShopMembership, ShopSettings
from .serializers import ShopSerializer, ShopSettingsSerializer, ShopWriteSerializer


class ShopViewSet(viewsets.ModelViewSet):
    """GET /shops — the shops the current user can access (not shop-scoped).
    Owners can also create branches, edit theirs, and archive them (v2 plan §3).
    Archiving is a soft-delete: the branch disappears from switchers but its
    financial history survives.
    """

    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_serializer_class(self):
        if self.action in {"create", "partial_update"}:
            return ShopWriteSerializer
        return ShopSerializer

    def get_permissions(self):
        if self.action in {"create", "partial_update", "destroy"}:
            return [IsAuthenticated(), IsOwner()]
        return super().get_permissions()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # schema generation
            return Shop.objects.none()
        user = self.request.user
        if self.action in {"partial_update", "destroy"}:
            # Writes: only branches the caller actually owns (404 otherwise).
            return Shop.objects.filter(owner=user, deleted_at__isnull=True)
        my_memberships = ShopMembership.objects.filter(user=user).select_related("role")
        return (
            Shop.objects.filter(memberships__user=user, deleted_at__isnull=True)
            .select_related("settings")
            .prefetch_related(Prefetch("memberships", queryset=my_memberships))
            .distinct()
            .order_by("name")
        )

    def _read_payload(self, shop) -> dict:
        shop = (
            Shop.objects.filter(pk=shop.pk)
            .select_related("settings")
            .prefetch_related(
                Prefetch(
                    "memberships",
                    queryset=ShopMembership.objects.filter(user=self.request.user).select_related(
                        "role"
                    ),
                )
            )
            .get()
        )
        return ShopSerializer(shop, context=self.get_serializer_context()).data

    @extend_schema(request=ShopWriteSerializer, responses={201: ShopSerializer})
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # New branches inherit business settings from the owner's newest branch.
        template = (
            ShopSettings.objects.filter(shop__owner=request.user, shop__deleted_at__isnull=True)
            .order_by("-created_at")
            .first()
        )
        with transaction.atomic():
            shop = serializer.save(owner=request.user)
            ShopSettings.objects.create(
                shop=shop,
                **(
                    {
                        "currency": template.currency,
                        "tax_rate": template.tax_rate,
                        "low_stock_default": template.low_stock_default,
                        "language": template.language,
                        "timezone": template.timezone,
                    }
                    if template
                    else {}
                ),
            )
            owner_role, _ = Role.objects.get_or_create(name=Role.Name.OWNER)
            ShopMembership.objects.create(user=request.user, shop=shop, role=owner_role)

        log_activity(
            user=request.user,
            action="shop.create",
            entity_type="shop",
            entity_id=shop.id,
            shop=shop,
            ip=get_client_ip(request),
            metadata={"name": shop.name},
        )
        return Response(self._read_payload(shop), status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        shop = self.get_object()
        serializer = self.get_serializer(shop, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        log_activity(
            user=request.user,
            action="shop.update",
            entity_type="shop",
            entity_id=shop.id,
            shop=shop,
            ip=get_client_ip(request),
            metadata={"changed": sorted(serializer.validated_data.keys())},
        )
        return Response(self._read_payload(shop))

    def destroy(self, request, *args, **kwargs):
        shop = self.get_object()
        remaining = Shop.objects.filter(owner=request.user, deleted_at__isnull=True).exclude(
            pk=shop.pk
        )
        if not remaining.exists():
            raise ValidationError({"detail": "You can't archive your only branch."})
        shop.delete()  # soft-delete (archive)
        log_activity(
            user=request.user,
            action="shop.archive",
            entity_type="shop",
            entity_id=shop.id,
            shop=shop,
            level="warn",
            ip=get_client_ip(request),
            metadata={"name": shop.name},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


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
