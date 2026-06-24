from rest_framework.routers import DefaultRouter

from .views import PurchaseViewSet

router = DefaultRouter(trailing_slash=False)
router.register("purchases", PurchaseViewSet, basename="purchase")

urlpatterns = [*router.urls]
