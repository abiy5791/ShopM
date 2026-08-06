from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.activity.services import log_activity
from apps.common.mixins import ShopScopedViewSetMixin
from apps.common.permissions import ROLE_OWNER, ActiveShopRolePermission
from apps.common.utils import get_client_ip
from apps.reports import summaries

from .models import Sale
from .serializers import ReceiptSerializer, SaleCreateSerializer, SaleSerializer
from .services import CheckoutError, InsufficientStockError, create_sale, void_sale


class CheckoutFailed(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "checkout_error"
    default_detail = "Checkout failed."


class SaleViewSet(
    ShopScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """POS sales. Create is idempotent on client_uuid; void is owner-only."""

    queryset = (
        Sale.objects.select_related("cashier", "shop", "shop__settings", "customer")
        .prefetch_related("items", "payments")
        .all()
    )
    permission_classes = [IsAuthenticated, ActiveShopRolePermission]
    filterset_fields = ["status", "cashier"]
    ordering_fields = ["created_at", "total"]
    # Create/list/retrieve/receipt/summary are open to any shop member; voiding
    # is owner-only.
    action_roles = {"void": [ROLE_OWNER]}

    def get_serializer_class(self):
        if self.action == "create":
            return SaleCreateSerializer
        if self.action == "receipt":
            return ReceiptSerializer
        return SaleSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if not getattr(self, "swagger_fake_view", False):
            ctx["active_shop"] = self.active_shop
        return ctx

    @extend_schema(
        request=SaleCreateSerializer, responses={201: SaleSerializer, 200: SaleSerializer}
    )
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            sale, created = create_sale(
                shop=self.active_shop,
                cashier=request.user,
                client_uuid=data["client_uuid"],
                items=data["items"],
                payments=data["payments"],
                discount=data["discount"],
                tax=data["tax"],
                notes=data["notes"],
                customer=data.get("customer"),
            )
        except InsufficientStockError as exc:
            # Structured envelope (plan §9): fields keyed by product id so the
            # POS can flag the exact offending cart lines.
            return Response(
                {
                    "detail": str(exc),
                    "code": "insufficient_stock",
                    "fields": exc.shortages,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except CheckoutError as exc:
            raise CheckoutFailed(str(exc)) from exc

        if created:
            log_activity(
                user=request.user,
                action="sale.create",
                entity_type="sale",
                entity_id=sale.id,
                shop=self.active_shop,
                ip=get_client_ip(request),
                metadata={"total": sale.total, "items": sale.items.count()},
            )

        out = SaleSerializer(sale, context=self.get_serializer_context())
        # Replays return 200 (not a duplicate); fresh sales return 201 (plan §9).
        return Response(out.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @extend_schema(request=None, responses={200: SaleSerializer})
    @action(detail=True, methods=["post"])
    def void(self, request, pk=None):
        sale = self.get_object()
        already = sale.status == Sale.Status.VOIDED
        void_sale(sale, user=request.user)
        if not already:
            log_activity(
                user=request.user,
                action="sale.void",
                entity_type="sale",
                entity_id=sale.id,
                shop=self.active_shop,
                level="warn",
                ip=get_client_ip(request),
                metadata={"total": sale.total},
            )
        return Response(SaleSerializer(sale, context=self.get_serializer_context()).data)

    @extend_schema(
        responses={200: {"type": "object"}},
        description=(
            "KPI cards shown above the sales table. Owners get the shop's takings "
            "(today, month, average, credit outstanding); a cashier gets the same "
            "figures for their own sales only — their till, not the shop's."
        ),
    )
    @action(detail=False, methods=["get"])
    def summary(self, request):
        cashier = None if self.active_role == ROLE_OWNER else request.user
        return Response(summaries.sales_summary(self.active_shop, cashier=cashier))

    @extend_schema(responses={200: ReceiptSerializer})
    @action(detail=True, methods=["get"])
    def receipt(self, request, pk=None):
        sale = self.get_object()
        return Response(ReceiptSerializer(sale).data)
