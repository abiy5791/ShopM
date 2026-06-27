from datetime import date

from django.http import HttpResponse
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.common.mixins import ShopScopedViewSetMixin
from apps.common.permissions import ROLE_OWNER, ActiveShopRolePermission

from . import services
from .exporters import to_pdf, to_xlsx
from .serializers import DashboardSerializer, ReportSerializer

_CONTENT_TYPES = {
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "application/pdf",
}


def _parse_date(value):
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _respond(report: dict, request):
    """Return the report as JSON, or as a downloadable PDF/XLSX via ?export=.

    Note: the param is ``export`` (not ``format``) because DRF reserves ``format``
    for content negotiation.
    """
    fmt = request.query_params.get("export", "json")
    if fmt in ("xlsx", "pdf"):
        content = to_xlsx(report) if fmt == "xlsx" else to_pdf(report)
        response = HttpResponse(content, content_type=_CONTENT_TYPES[fmt])
        response["Content-Disposition"] = f'attachment; filename="{report["key"]}.{fmt}"'
        return response
    return Response(report)


class DashboardView(ShopScopedViewSetMixin, generics.GenericAPIView):
    """GET /dashboard — today's headline numbers for the active shop. Owner only."""

    permission_classes = [IsAuthenticated, ActiveShopRolePermission]
    required_roles = {ROLE_OWNER}
    serializer_class = DashboardSerializer

    @extend_schema(responses={200: DashboardSerializer})
    def get(self, request, *args, **kwargs):
        return Response(services.dashboard(self.active_shop))


_FORMAT_PARAM = OpenApiParameter("export", str, enum=["pdf", "xlsx"])
_RANGE_PARAMS = [
    OpenApiParameter("start", str, description="YYYY-MM-DD"),
    OpenApiParameter("end", str, description="YYYY-MM-DD"),
    _FORMAT_PARAM,
]


class ReportsViewSet(ShopScopedViewSetMixin, viewsets.GenericViewSet):
    """Financial reports for the active shop. Owner only (plan §8)."""

    permission_classes = [IsAuthenticated, ActiveShopRolePermission]
    required_roles = {ROLE_OWNER}
    serializer_class = ReportSerializer

    @extend_schema(
        parameters=[
            OpenApiParameter("period", str, enum=["daily", "weekly", "monthly", "yearly"]),
            *_RANGE_PARAMS,
        ],
        responses={200: ReportSerializer},
    )
    @action(detail=False)
    def sales(self, request):
        report = services.sales_report(
            self.active_shop,
            period=request.query_params.get("period", "daily"),
            start=_parse_date(request.query_params.get("start")),
            end=_parse_date(request.query_params.get("end")),
        )
        return _respond(report, request)

    @extend_schema(parameters=[_FORMAT_PARAM])
    @action(detail=False)
    def inventory(self, request):
        return _respond(services.inventory_report(self.active_shop), request)

    @extend_schema(parameters=_RANGE_PARAMS)
    @action(detail=False)
    def profit(self, request):
        report = services.profit_report(
            self.active_shop,
            start=_parse_date(request.query_params.get("start")),
            end=_parse_date(request.query_params.get("end")),
        )
        return _respond(report, request)

    @extend_schema(parameters=_RANGE_PARAMS)
    @action(detail=False)
    def cashflow(self, request):
        report = services.cashflow_report(
            self.active_shop,
            start=_parse_date(request.query_params.get("start")),
            end=_parse_date(request.query_params.get("end")),
        )
        return _respond(report, request)
