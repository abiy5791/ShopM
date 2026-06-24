from rest_framework import serializers

from apps.catalog.models import Product, Supplier

from .models import Purchase, PurchaseItem


class PurchaseItemInputSerializer(serializers.Serializer):
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    quantity = serializers.IntegerField(min_value=1)
    unit_cost = serializers.IntegerField(min_value=0)


class PurchaseCreateSerializer(serializers.Serializer):
    supplier = serializers.PrimaryKeyRelatedField(
        queryset=Supplier.objects.all(), required=False, allow_null=True
    )
    items = PurchaseItemInputSerializer(many=True)
    amount_paid = serializers.IntegerField(min_value=0, default=0)
    date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_items(self, items):
        if not items:
            raise serializers.ValidationError("A purchase must have at least one item.")
        shop = self.context.get("active_shop")
        for item in items:
            if shop is not None and item["product"].shop_id != shop.id:
                raise serializers.ValidationError("Product not found in the active shop.")
        return items

    def validate_supplier(self, supplier):
        shop = self.context.get("active_shop")
        if supplier is not None and shop is not None and supplier.shop_id != shop.id:
            raise serializers.ValidationError("Supplier not found in the active shop.")
        return supplier


class PurchaseItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_sku = serializers.CharField(source="product.sku", read_only=True)

    class Meta:
        model = PurchaseItem
        fields = [
            "id",
            "product",
            "product_name",
            "product_sku",
            "quantity",
            "unit_cost",
            "line_total",
        ]
        read_only_fields = fields


class PurchaseSerializer(serializers.ModelSerializer):
    items = PurchaseItemSerializer(many=True, read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default=None)

    class Meta:
        model = Purchase
        fields = [
            "id",
            "supplier",
            "supplier_name",
            "total",
            "amount_paid",
            "payment_status",
            "date",
            "notes",
            "items",
            "created_at",
        ]
        read_only_fields = fields
