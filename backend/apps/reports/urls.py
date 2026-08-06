from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import DashboardView, DayBookView, ReportsViewSet, ShiftView

router = DefaultRouter(trailing_slash=False)
router.register("reports", ReportsViewSet, basename="reports")

urlpatterns = [
    path("dashboard", DashboardView.as_view(), name="dashboard"),
    path("shift", ShiftView.as_view(), name="shift"),
    path("reports/day", DayBookView.as_view(), name="reports-day"),
    *router.urls,
]
