from rest_framework import serializers

from apps.catalog.models import Product

from .models import InventoryTransaction
from .services import MANUAL_TYPES


class InventoryTransactionSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_sku = serializers.CharField(source="product.sku", read_only=True)
    user_email = serializers.EmailField(source="user.email", read_only=True, default=None)

    class Meta:
        model = InventoryTransaction
        fields = [
            "id",
            "product",
            "product_name",
            "product_sku",
            "quantity",
            "type",
            "unit_cost",
            "reference_type",
            "reference_id",
            "user",
            "user_email",
            "notes",
            "created_at",
        ]
        read_only_fields = fields


class StockAdjustmentSerializer(serializers.Serializer):
    """Input for POST /inventory/adjust — a manual, signed stock movement."""

    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    quantity = serializers.IntegerField()
    type = serializers.ChoiceField(choices=sorted(MANUAL_TYPES))
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_quantity(self, value):
        if value == 0:
            raise serializers.ValidationError("Quantity must be non-zero.")
        return value

    def validate_product(self, product):
        shop = self.context.get("active_shop")
        if shop is not None and product.shop_id != shop.id:
            raise serializers.ValidationError("Product not found in the active shop.")
        return product
