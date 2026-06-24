from rest_framework import serializers

from .models import Expense, ExpenseCategory


class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = ["id", "name", "created_at"]
        read_only_fields = ["id", "created_at"]


class ExpenseSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True, default=None)
    receipt_image_url = serializers.SerializerMethodField()

    class Meta:
        model = Expense
        fields = [
            "id",
            "category",
            "category_name",
            "amount",
            "date",
            "description",
            "receipt_image",
            "receipt_image_url",
            "created_at",
        ]
        read_only_fields = ["id", "category_name", "receipt_image_url", "created_at"]
        extra_kwargs = {"receipt_image": {"write_only": True, "required": False}}

    def get_receipt_image_url(self, expense):
        if not expense.receipt_image:
            return None
        url = expense.receipt_image.url
        request = self.context.get("request")
        return request.build_absolute_uri(url) if request else url

    def validate_category(self, category):
        shop = self.context.get("active_shop")
        if category is not None and shop is not None and category.shop_id != shop.id:
            raise serializers.ValidationError("Category not found in the active shop.")
        return category
