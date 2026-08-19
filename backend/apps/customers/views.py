from drf_spectacular.utils import extend_schema
from rest_framework import generics, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.activity.services import log_activity
from apps.common.mixins import ShopScopedViewSetMixin
from apps.common.permissions import ActiveShopRolePermission
from apps.common.utils import get_client_ip
from apps.common.viewsets import ShopScopedModelViewSet
from apps.reports import summaries

from .models import Customer
from .serializers import CustomerPaymentSerializer, CustomerSerializer
from .services import recompute_customer_balance


class CustomerViewSet(ShopScopedModelViewSet):
    """Customer CRUD — available to owner and cashier (plan §8)."""

    serializer_class = CustomerSerializer
    queryset = Customer.objects.all()
    search_fields = ["name", "phone"]
    ordering_fields = ["name", "credit_balance_cached", "created_at"]

    @extend_schema(
        responses={200: {"type": "object"}},
        description="KPI cards shown above the customers table. Readable by any "
        "member — credit balances are already on the list itself.",
    )
    @action(detail=False, methods=["get"])
    def summary(self, request):
        return Response(summaries.customers_summary(self.active_shop))

    @extend_schema(responses={200: dict})
    @action(detail=True, methods=["get"])
    def ledger(self, request, pk=None):
        """Outstanding balance + sale and payment history for a customer."""
        from apps.sales.models import Payment, Sale

        customer = self.get_object()
        balance = recompute_customer_balance(customer)
        sales = (
            Sale.objects.filter(customer=customer)
            .order_by("-occurred_at")
            .values("id", "total", "status", "occurred_at")[:100]
        )
        payments = (
            Payment.objects.filter(customer=customer)
            .order_by("-received_at")
            .values("id", "method", "amount", "sale", "received_at")[:100]
        )
        return Response(
            {
                "customer_id": str(customer.id),
                "balance": balance,
                "sales": list(sales),
                "payments": list(payments),
            }
        )


class CustomerPaymentView(ShopScopedViewSetMixin, generics.GenericAPIView):
    """POST /payments — record a settlement against a customer's credit."""

    serializer_class = CustomerPaymentSerializer
    permission_classes = [IsAuthenticated, ActiveShopRolePermission]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if not getattr(self, "swagger_fake_view", False):
            ctx["active_shop"] = self.active_shop
        return ctx

    @extend_schema(responses={201: dict})
    def post(self, request, *args, **kwargs):
        from apps.sales.models import Payment

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        customer = data["customer"]

        payment = Payment.objects.create(
            shop=self.active_shop,
            customer=customer,
            sale=None,
            method=data["method"],
            amount=data["amount"],
            user=request.user,
        )
        balance = recompute_customer_balance(customer)
        log_activity(
            user=request.user,
            action="customer.payment",
            entity_type="customer",
            entity_id=customer.id,
            shop=self.active_shop,
            ip=get_client_ip(request),
            metadata={"amount": data["amount"], "method": data["method"], "balance": balance},
        )
        return Response(
            {"payment_id": str(payment.id), "balance": balance},
            status=status.HTTP_201_CREATED,
        )
