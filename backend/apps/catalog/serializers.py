from rest_framework import serializers

from .models import Category, Product, Supplier


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "created_at"]
        read_only_fields = ["id", "created_at"]


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ["id", "name", "phone", "address", "notes", "created_at"]
        read_only_fields = ["id", "created_at"]


class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True, default=None)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, default=None)
    is_low_stock = serializers.BooleanField(read_only=True)

    class Meta:
        model = Product
        fields = [
            "id",
            "name",
            "sku",
            "barcode",
            "category",
            "category_name",
            "supplier",
            "supplier_name",
            # Money is integer minor units (plan §3.5) — the client formats for display.
            "purchase_price",
            "selling_price",
            "unit",
            "min_stock_alert",
            "status",
            "stock_cached",
            "is_low_stock",
            "created_at",
            "updated_at",
        ]
        # stock_cached is owned by the ledger, never set directly via this endpoint.
        read_only_fields = ["id", "stock_cached", "is_low_stock", "created_at", "updated_at"]

    def validate(self, attrs):
        shop = self.context.get("active_shop")
        for field in ("category", "supplier"):
            obj = attrs.get(field)
            if obj is not None and shop is not None and obj.shop_id != shop.id:
                raise serializers.ValidationError({field: "Must belong to the active shop."})
        return attrs

    def validate_sku(self, value):
        shop = self.context.get("active_shop")
        if shop is None:
            return value
        qs = Product.objects.filter(shop=shop, sku=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(
                "A product with this SKU already exists in this shop."
            )
        return value
