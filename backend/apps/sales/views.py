from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.activity.services import log_activity
from apps.common.mixins import ShopScopedViewSetMixin
from apps.common.permissions import ROLE_OWNER, ActiveShopRolePermission
from apps.common.utils import get_client_ip
from apps.reports import summaries

from . import backdating
from .amend import SaleNotEditable, amend_sale
from .models import Sale
from .serializers import (
    ReceiptSerializer,
    SaleCreateSerializer,
    SaleSerializer,
    SaleUpdateSerializer,
)
from .services import CheckoutError, InsufficientStockError, create_sale, void_sale


class CheckoutFailed(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "checkout_error"
    default_detail = "Checkout failed."


class SaleViewSet(
    ShopScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """POS sales. Create is idempotent on client_uuid; editing and voiding a
    recorded sale are owner-only."""

    queryset = (
        Sale.objects.select_related("cashier", "shop", "shop__settings", "customer")
        .prefetch_related("items", "payments", "amendments__user")
        .all()
    )
    permission_classes = [IsAuthenticated, ActiveShopRolePermission]
    filterset_fields = ["status", "cashier"]
    ordering_fields = ["occurred_at", "created_at", "total"]
    # Create/list/retrieve/receipt/summary are open to any shop member.
    # Correcting or voiding a recorded sale rewrites money already reported on,
    # so both are owner-only.
    action_roles = {
        "void": [ROLE_OWNER],
        "update": [ROLE_OWNER],
        "partial_update": [ROLE_OWNER],
    }

    def get_serializer_class(self):
        if self.action == "create":
            return SaleCreateSerializer
        if self.action in ("update", "partial_update"):
            return SaleUpdateSerializer
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

        # Backdating is owner-only and rewrites which day the books credit, so
        # the gate is here — a 403, not a silently-dropped field. The date range
        # itself was already checked by the serializer.
        sale_date = data.get("sale_date")
        occurred_at = None
        if sale_date is not None:
            if self.active_role != ROLE_OWNER:
                raise PermissionDenied("Only the shop owner can record a sale for another date.")
            occurred_at = backdating.to_datetime(sale_date)

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
                occurred_at=occurred_at,
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
            # A backdated sale is logged at warn level naming the day it was
            # moved to — the audit trail is the whole safeguard around this.
            backdated = sale.is_backdated
            log_activity(
                user=request.user,
                action="sale.create",
                entity_type="sale",
                entity_id=sale.id,
                shop=self.active_shop,
                level="warn" if backdated else "info",
                ip=get_client_ip(request),
                metadata={
                    "total": sale.total,
                    "items": sale.items.count(),
                    "sale_date": str(timezone.localdate(sale.occurred_at)),
                    "backdated": backdated,
                },
            )

        out = SaleSerializer(sale, context=self.get_serializer_context())
        # Replays return 200 (not a duplicate); fresh sales return 201 (plan §9).
        return Response(out.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @extend_schema(
        request=SaleUpdateSerializer,
        responses={200: SaleSerializer},
        description=(
            "Correct a sale that was recorded wrong — wrong quantity, wrong "
            "payment method, wrong day, wrong customer. Owner only, and a reason "
            "is required. Only the fields sent are changed; sending `items` or "
            "`payments` replaces that whole list. Stock moves by the net "
            "difference, totals are recomputed server-side, and the full "
            "before/after is kept in the sale's amendment history. Use void "
            "instead when the sale never happened at all."
        ),
    )
    def update(self, request, *args, **kwargs):
        sale = self.get_object()
        serializer = self.get_serializer(
            data=request.data,
            # A product deactivated since the sale may stay on it; the serializer
            # needs to know which products are already there to allow that.
            context={
                **self.get_serializer_context(),
                "existing_product_ids": set(sale.items.values_list("product_id", flat=True)),
            },
        )
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        reason = data.pop("reason")

        # The edited date obeys exactly the same policy as a new sale's.
        sale_date = data.pop("sale_date", None)
        if sale_date is not None:
            data["occurred_at"] = backdating.to_datetime(sale_date)

        try:
            sale, amendment = amend_sale(
                sale=sale, user=request.user, reason=reason, validated=data
            )
        except InsufficientStockError as exc:
            return Response(
                {
                    "detail": str(exc),
                    "code": "insufficient_stock",
                    "fields": exc.shortages,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except SaleNotEditable as exc:
            raise CheckoutFailed(str(exc)) from exc
        except CheckoutError as exc:
            raise CheckoutFailed(str(exc)) from exc

        log_activity(
            user=request.user,
            action="sale.update",
            entity_type="sale",
            entity_id=sale.id,
            shop=self.active_shop,
            # Editing recorded money is always worth surfacing in the audit trail.
            level="warn",
            ip=get_client_ip(request),
            metadata={
                "reason": reason,
                "total": sale.total,
                "changes": amendment.changes,
            },
        )

        # Re-read: the object was loaded with items/payments prefetched, so the
        # serializer would otherwise render the pre-edit lines.
        fresh = self.get_queryset().get(pk=sale.pk)
        return Response(SaleSerializer(fresh, context=self.get_serializer_context()).data)

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

    @extend_schema(
        responses={200: {"type": "object"}},
        description=(
            "The window a sale may be dated to, and whether this member may use "
            "it. The POS bounds its date picker with this so the rule lives on "
            "the server only."
        ),
    )
    @action(detail=False, methods=["get"], url_path="date-window")
    def date_window(self, request):
        earliest, latest = backdating.allowed_range()
        return Response(
            {
                "earliest": str(earliest),
                "latest": str(latest),
                "max_days": backdating.MAX_BACKDATE_DAYS,
                "allowed": self.active_role == ROLE_OWNER,
            }
        )

    @extend_schema(responses={200: ReceiptSerializer})
    @action(detail=True, methods=["get"])
    def receipt(self, request, pk=None):
        sale = self.get_object()
        return Response(ReceiptSerializer(sale).data)
