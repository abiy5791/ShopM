from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import DashboardView, ReportsViewSet

router = DefaultRouter(trailing_slash=False)
router.register("reports", ReportsViewSet, basename="reports")

urlpatterns = [
    path("dashboard", DashboardView.as_view(), name="dashboard"),
    *router.urls,
]
