from rest_framework.parsers import FormParser, JSONParser, MultiPartParser

from apps.activity.services import log_activity
from apps.common.permissions import ROLE_OWNER
from apps.common.utils import get_client_ip
from apps.common.viewsets import ShopScopedModelViewSet

from .models import Expense, ExpenseCategory
from .serializers import ExpenseCategorySerializer, ExpenseSerializer

OWNER_ONLY = {action: [ROLE_OWNER] for action in ["create", "update", "partial_update", "destroy"]}


class ExpenseCategoryViewSet(ShopScopedModelViewSet):
    """Owner-managed expense categories."""

    serializer_class = ExpenseCategorySerializer
    queryset = ExpenseCategory.objects.all()
    required_roles = {ROLE_OWNER}
    search_fields = ["name"]
    ordering_fields = ["name"]


class ExpenseViewSet(ShopScopedModelViewSet):
    """Shop expenses with optional receipt image. Owner only (plan §8)."""

    serializer_class = ExpenseSerializer
    queryset = Expense.objects.select_related("category").all()
    required_roles = {ROLE_OWNER}
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filterset_fields = ["category"]
    search_fields = ["description"]
    ordering_fields = ["date", "amount", "created_at"]

    def _log(self, action_name, expense):
        log_activity(
            user=self.request.user,
            action=action_name,
            entity_type="expense",
            entity_id=expense.id,
            shop=self.active_shop,
            ip=get_client_ip(self.request),
            metadata={"amount": expense.amount},
        )

    def perform_create(self, serializer):
        expense = serializer.save(shop=self.active_shop, user=self.request.user)
        self._log("expense.create", expense)

    def perform_update(self, serializer):
        expense = serializer.save()
        self._log("expense.update", expense)

    def perform_destroy(self, instance):
        instance.delete()  # soft delete (plan §3.6)
        self._log("expense.delete", instance)
