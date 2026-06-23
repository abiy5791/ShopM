from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import InventoryTransactionViewSet, StockAdjustView

router = DefaultRouter(trailing_slash=False)
router.register(
    "inventory/transactions", InventoryTransactionViewSet, basename="inventory-transaction"
)

urlpatterns = [
    path("inventory/adjust", StockAdjustView.as_view(), name="inventory-adjust"),
    *router.urls,
]
