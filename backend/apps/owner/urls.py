from django.urls import path

from .views import OwnerActivityView, OwnerCompareView, OwnerDashboardView

urlpatterns = [
    path("owner/dashboard", OwnerDashboardView.as_view(), name="owner-dashboard"),
    path("owner/shops/compare", OwnerCompareView.as_view(), name="owner-compare"),
    path("owner/activity", OwnerActivityView.as_view(), name="owner-activity"),
]
