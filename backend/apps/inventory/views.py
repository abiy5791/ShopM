from drf_spectacular.utils import extend_schema
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from apps.activity.services import log_activity
from apps.common.mixins import ShopScopedViewSetMixin
from apps.common.permissions import ROLE_OWNER, ActiveShopRolePermission
from apps.common.utils import get_client_ip

from .models import InventoryTransaction
from .serializers import InventoryTransactionSerializer, StockAdjustmentSerializer
from .services import NegativeStockError, record_transaction


class InventoryTransactionViewSet(ShopScopedViewSetMixin, ReadOnlyModelViewSet):
    """GET /inventory/transactions — the stock ledger for the active shop. Owner only."""

    serializer_class = InventoryTransactionSerializer
    queryset = InventoryTransaction.objects.select_related("product", "user").all()
    permission_classes = [IsAuthenticated, ActiveShopRolePermission]
    required_roles = {ROLE_OWNER}
    filterset_fields = ["product", "type"]
    search_fields = ["product__name", "product__sku", "notes"]
    ordering_fields = ["created_at", "quantity"]


class StockAdjustView(ShopScopedViewSetMixin, generics.GenericAPIView):
    """POST /inventory/adjust — manual signed stock movement → one ledger row
    + cached-stock update in a single DB transaction (plan §3.2). Owner only."""

    serializer_class = StockAdjustmentSerializer
    permission_classes = [IsAuthenticated, ActiveShopRolePermission]
    required_roles = {ROLE_OWNER}

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if not getattr(self, "swagger_fake_view", False):
            ctx["active_shop"] = self.active_shop
        return ctx

    @extend_schema(responses={201: InventoryTransactionSerializer})
    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            txn = record_transaction(
                product=data["product"],
                quantity=data["quantity"],
                type=data["type"],
                user=request.user,
                notes=data.get("notes", ""),
            )
        except NegativeStockError as exc:
            return Response(
                {
                    "detail": str(exc),
                    "code": "adjustment_below_zero",
                    "fields": {
                        "quantity": [
                            f"Only {exc.available} in stock; cannot remove {exc.requested}."
                        ]
                    },
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        from apps.notifications.services import notify_low_stock

        notify_low_stock(data["product"])
        log_activity(
            user=request.user,
            action="inventory.adjust",
            entity_type="product",
            entity_id=data["product"].id,
            shop=self.active_shop,
            ip=get_client_ip(request),
            metadata={
                "type": data["type"],
                "quantity": data["quantity"],
                "new_stock": data["product"].stock_cached,
            },
        )
        out = InventoryTransactionSerializer(txn)
        return Response(out.data, status=status.HTTP_201_CREATED)
