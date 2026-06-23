from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from .mixins import ShopScopedViewSetMixin
from .permissions import ActiveShopRolePermission


class ShopScopedModelViewSet(ShopScopedViewSetMixin, ModelViewSet):
    """CRUD viewset auto-scoped to the active shop, with RBAC.

    Declare ``action_roles`` (e.g. {"create": ["owner"], ...}) to gate writes;
    reads stay open to any shop member by default.
    """

    permission_classes = [IsAuthenticated, ActiveShopRolePermission]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if not getattr(self, "swagger_fake_view", False):
            ctx["active_shop"] = self.active_shop
        return ctx
