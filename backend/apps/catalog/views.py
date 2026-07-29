from django.db import transaction
from django.db.models import F
from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from apps.activity.services import log_activity
from apps.common.permissions import ROLE_OWNER
from apps.common.utils import get_client_ip
from apps.common.viewsets import ShopScopedModelViewSet

from . import excel, pdf
from .models import Category, Product, Supplier
from .serializers import CategorySerializer, ProductSerializer, SupplierSerializer

OWNER_WRITE = {
    "create": [ROLE_OWNER],
    "update": [ROLE_OWNER],
    "partial_update": [ROLE_OWNER],
    "destroy": [ROLE_OWNER],
}

XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PDF_CONTENT_TYPE = "application/pdf"
XLSX_EXTENSIONS = (".xlsx", ".xlsm")
#: An .xlsx catalogue far smaller than this holds tens of thousands of rows.
MAX_IMPORT_BYTES = 5 * 1024 * 1024


def file_response(content: bytes, filename: str, content_type: str) -> HttpResponse:
    response = HttpResponse(content, content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def bad_request(detail: str, code: str) -> Response:
    return Response(
        {"detail": detail, "code": code, "fields": {}},
        status=status.HTTP_400_BAD_REQUEST,
    )


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
    action_roles = {
        **OWNER_WRITE,
        "import_products": [ROLE_OWNER],
        "import_template": [ROLE_OWNER],
    }

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

    def _currency(self) -> str:
        settings = getattr(self.active_shop, "settings", None)
        return settings.currency if settings else "ETB"

    def _parse_initial_stock(self) -> int:
        try:
            return max(0, int(self.request.data.get("initial_stock") or 0))
        except (TypeError, ValueError):
            return 0

    def perform_create(self, serializer):
        from .services import generate_sku

        extra = {}
        # Server-side SKU: generate a unique, category-prefixed code when the
        # client doesn't supply one (the form no longer asks the user to type it).
        if not serializer.validated_data.get("sku"):
            extra["sku"] = generate_sku(self.active_shop, serializer.validated_data.get("category"))
        # New products fall back to the shop's low-stock default (v2 plan §5)
        # so low-stock alerts work without per-product setup.
        if "min_stock_alert" not in serializer.validated_data:
            settings = getattr(self.active_shop, "settings", None)
            if settings is not None:
                extra["min_stock_alert"] = settings.low_stock_default

        initial_stock = self._parse_initial_stock()
        with transaction.atomic():
            product = serializer.save(shop=self.active_shop, **extra)
            # Opening stock still flows through the ledger (the one place stock
            # ever changes), so the balance stays reconcilable.
            if initial_stock:
                from apps.inventory.services import record_transaction

                record_transaction(
                    product=product,
                    quantity=initial_stock,
                    type="adjustment",
                    user=self.request.user,
                    notes="Opening stock",
                )
        self._log("product.create", product)

    def perform_update(self, serializer):
        product = serializer.save()
        self._log("product.update", product)

    def perform_destroy(self, instance):
        instance.delete()  # soft delete (plan §3.6)
        self._log("product.delete", instance)

    @extend_schema(
        responses={200: {"type": "array", "items": {"type": "string"}}},
        description="Distinct units of measure already used in this shop (for pick-lists).",
    )
    @action(detail=False, methods=["get"])
    def units(self, request):
        units = (
            Product.objects.filter(shop=self.active_shop)
            .exclude(unit="")
            .values_list("unit", flat=True)
            .distinct()
        )
        return Response(sorted(set(units)))

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
        parameters=[OpenApiParameter("export", str, enum=["xlsx", "pdf"])],
        description=(
            "Export all products in the active shop. .xlsx is the round-trip "
            "format the importer reads; .pdf is a printable catalogue."
        ),
        responses={(200, XLSX_CONTENT_TYPE): bytes, (200, PDF_CONTENT_TYPE): bytes},
    )
    @action(detail=False, methods=["get"])
    def export(self, request):
        currency = self._currency()
        stamp = f"{timezone.localdate():%Y-%m-%d}"
        # ``export`` rather than ``format``: DRF reserves the latter for content
        # negotiation (same convention as /reports).
        if request.query_params.get("export") == "pdf":
            content = pdf.export_products_pdf(
                self.get_queryset(), shop_name=self.active_shop.name, currency=currency
            )
            return file_response(content, f"products-{stamp}.pdf", PDF_CONTENT_TYPE)
        content = excel.export_products(self.get_queryset(), currency=currency)
        return file_response(content, f"products-{stamp}.xlsx", XLSX_CONTENT_TYPE)

    @extend_schema(
        description="A blank .xlsx with the header row the importer expects. Owner only.",
        responses={(200, XLSX_CONTENT_TYPE): bytes},
    )
    @action(detail=False, methods=["get"], url_path="import-template")
    def import_template(self, request):
        content = excel.import_template(currency=self._currency())
        return file_response(content, "products-import-template.xlsx", XLSX_CONTENT_TYPE)

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
            return bad_request("No file provided.", "file_required")
        if not str(upload.name or "").lower().endswith(XLSX_EXTENSIONS):
            return bad_request("Only .xlsx files can be imported.", "invalid_file_type")
        if upload.size and upload.size > MAX_IMPORT_BYTES:
            limit = MAX_IMPORT_BYTES // (1024 * 1024)
            return bad_request(f"That file is larger than {limit} MB.", "file_too_large")

        try:
            result = excel.import_products(
                upload,
                shop=self.active_shop,
                currency=self._currency(),
                user=request.user,
            )
        except excel.SpreadsheetError as exc:
            return bad_request(str(exc), "invalid_spreadsheet")

        log_activity(
            user=request.user,
            action="product.import",
            entity_type="product",
            shop=self.active_shop,
            ip=get_client_ip(request),
            # Counts only — the per-row errors can be long and belong to the response.
            metadata={k: v for k, v in result.items() if k != "errors"},
        )
        return Response(result)
