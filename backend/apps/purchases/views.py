from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.activity.services import log_activity
from apps.common.mixins import ShopScopedViewSetMixin
from apps.common.permissions import ROLE_OWNER, ActiveShopRolePermission
from apps.common.utils import get_client_ip

from .models import Purchase
from .serializers import PurchaseCreateSerializer, PurchaseSerializer
from .services import create_purchase


class PurchaseViewSet(
    ShopScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Stock purchases. Owner only (cashiers are denied — plan §8)."""

    queryset = Purchase.objects.select_related("supplier").prefetch_related("items__product").all()
    permission_classes = [IsAuthenticated, ActiveShopRolePermission]
    required_roles = {ROLE_OWNER}
    filterset_fields = ["payment_status", "supplier"]
    ordering_fields = ["date", "created_at", "total"]

    def get_serializer_class(self):
        return PurchaseCreateSerializer if self.action == "create" else PurchaseSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if not getattr(self, "swagger_fake_view", False):
            ctx["active_shop"] = self.active_shop
        return ctx

    @extend_schema(request=PurchaseCreateSerializer, responses={201: PurchaseSerializer})
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        purchase = create_purchase(
            shop=self.active_shop,
            user=request.user,
            supplier=data.get("supplier"),
            items=data["items"],
            amount_paid=data["amount_paid"],
            date=data.get("date"),
            notes=data["notes"],
        )
        log_activity(
            user=request.user,
            action="purchase.create",
            entity_type="purchase",
            entity_id=purchase.id,
            shop=self.active_shop,
            ip=get_client_ip(request),
            metadata={"total": purchase.total, "items": purchase.items.count()},
        )
        out = PurchaseSerializer(purchase, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)
