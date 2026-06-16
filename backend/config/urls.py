from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def healthz(_request):
    return JsonResponse({"status": "ok"})


api_v1 = [
    path("", include("apps.accounts.urls")),
    path("", include("apps.shops.urls")),
    path("", include("apps.activity.urls")),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path("docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz/", healthz, name="healthz"),
    path("api/v1/", include(api_v1)),
]
