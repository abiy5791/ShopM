from rest_framework.routers import DefaultRouter

from .views import ActivityLogViewSet

router = DefaultRouter(trailing_slash=False)
router.register("activity", ActivityLogViewSet, basename="activity")

urlpatterns = [*router.urls]
