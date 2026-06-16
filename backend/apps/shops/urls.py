from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ShopSettingsView, ShopViewSet

router = DefaultRouter(trailing_slash=False)
router.register("shops", ShopViewSet, basename="shop")

urlpatterns = [
    path("settings", ShopSettingsView.as_view(), name="settings"),
    *router.urls,
]
