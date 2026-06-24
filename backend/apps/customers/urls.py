from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import CustomerPaymentView, CustomerViewSet

router = DefaultRouter(trailing_slash=False)
router.register("customers", CustomerViewSet, basename="customer")

urlpatterns = [
    path("payments", CustomerPaymentView.as_view(), name="customer-payment"),
    *router.urls,
]
