from django.db.models import F
from django.http import HttpResponse
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from apps.activity.services import log_activity
from apps.common.permissions import ROLE_OWNER
from apps.common.utils import get_client_ip
from apps.common.viewsets import ShopScopedModelViewSet

from . import excel
from .models import Category, Product, Supplier
from .serializers import CategorySerializer, ProductSerializer, SupplierSerializer

OWNER_WRITE = {
    "create": [ROLE_OWNER],
    "update": [ROLE_OWNER],
    "partial_update": [ROLE_OWNER],
    "destroy": [ROLE_OWNER],
}


class CategoryViewSet(ShopScopedModelViewSet):
    serializer_class = CategorySerializer
    queryset = Category.objects.all()
    search_fields = ["name"]
    ordering_fields = ["name", "created_at"]
    action_roles = OWNER_WRITE


class SupplierViewSet(ShopScopedModelViewSet):
    serializer_class = SupplierSerializer
    queryset = Supplier.objects.all()
    search_fields = ["name", "phone"]
    ordering_fields = ["name", "created_at"]
    action_roles = OWNER_WRITE


class ProductViewSet(ShopScopedModelViewSet):
    serializer_class = ProductSerializer
    queryset = Product.objects.select_related("category", "supplier").all()
    search_fields = ["name", "sku", "barcode"]
    filterset_fields = ["status", "category"]
    ordering_fields = ["name", "selling_price", "stock_cached", "created_at"]
    # Owner manages catalog; cashiers have read-only access (plan §8).
    action_roles = {**OWNER_WRITE, "import_products": [ROLE_OWNER]}

    def get_queryset(self):
        qs = super().get_queryset()
        low_stock = self.request.query_params.get("low_stock")
        if low_stock in ("1", "true", "True"):
            qs = qs.filter(stock_cached__lte=F("min_stock_alert"))
        return qs

    def _log(self, action_name, product):
        log_activity(
            user=self.request.user,
            action=action_name,
            entity_type="product",
            entity_id=product.id,
            shop=self.active_shop,
            ip=get_client_ip(self.request),
            metadata={"sku": product.sku, "name": product.name},
        )

    def perform_create(self, serializer):
        extra = {}
        # New products fall back to the shop's low-stock default (v2 plan §5)
        # so low-stock alerts work without per-product setup.
        if "min_stock_alert" not in serializer.validated_data:
            settings = getattr(self.active_shop, "settings", None)
            if settings is not None:
                extra["min_stock_alert"] = settings.low_stock_default
        product = serializer.save(shop=self.active_shop, **extra)
        self._log("product.create", product)

    def perform_update(self, serializer):
        product = serializer.save()
        self._log("product.update", product)

    def perform_destroy(self, instance):
        instance.delete()  # soft delete (plan §3.6)
        self._log("product.delete", instance)

    @extend_schema(
        responses={200: {"type": "object"}},
        description="Derived stock for a product: cached value and the live ledger sum.",
    )
    @action(detail=True, methods=["get"])
    def stock(self, request, pk=None):
        from apps.inventory.services import ledger_stock

        product = self.get_object()
        return Response(
            {
                "product_id": product.id,
                "stock_cached": product.stock_cached,
                "ledger_stock": ledger_stock(product),
                "min_stock_alert": product.min_stock_alert,
                "is_low_stock": product.is_low_stock,
            }
        )

    @extend_schema(
        description="Export all products in the active shop as an .xlsx file.",
        responses={
            (200, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"): bytes
        },
    )
    @action(detail=False, methods=["get"])
    def export(self, request):
        content = excel.export_products(self.get_queryset())
        response = HttpResponse(
            content,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = 'attachment; filename="products.xlsx"'
        return response

    @extend_schema(
        request={
            "multipart/form-data": {
                "type": "object",
                "properties": {"file": {"type": "string", "format": "binary"}},
            }
        },
        responses={200: {"type": "object"}},
        description="Import/upsert products from an .xlsx file (keyed on SKU). Owner only.",
    )
    @action(
        detail=False,
        methods=["post"],
        url_path="import",
        parser_classes=[MultiPartParser],
    )
    def import_products(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            return Response(
                {"detail": "No file provided.", "code": "file_required", "fields": {}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        result = excel.import_products(upload, shop=self.active_shop)
        log_activity(
            user=request.user,
            action="product.import",
            entity_type="product",
            shop=self.active_shop,
            ip=get_client_ip(request),
            metadata=result,
        )
        return Response(result)
