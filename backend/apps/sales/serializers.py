from rest_framework import serializers

from apps.catalog.models import Product
from apps.customers.models import Customer

from .models import Payment, Sale, SaleItem


# ---------------------------------------------------------------- input
class SaleItemInputSerializer(serializers.Serializer):
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    quantity = serializers.IntegerField(min_value=1)
    # Optional snapshot price (integer minor units). Defaults to the product's
    # current selling price server-side if omitted.
    unit_price = serializers.IntegerField(min_value=0, required=False)


class PaymentInputSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=Payment.Method.choices)
    amount = serializers.IntegerField(min_value=0)


class SaleCreateSerializer(serializers.Serializer):
    client_uuid = serializers.UUIDField()
    items = SaleItemInputSerializer(many=True)
    payments = PaymentInputSerializer(many=True)
    customer = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(), required=False, allow_null=True
    )
    discount = serializers.IntegerField(min_value=0, default=0)
    tax = serializers.IntegerField(min_value=0, default=0)
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_items(self, items):
        if not items:
            raise serializers.ValidationError("A sale must have at least one item.")
        shop = self.context.get("active_shop")
        for item in items:
            product = item["product"]
            if shop is not None and product.shop_id != shop.id:
                raise serializers.ValidationError("Product not found in the active shop.")
        return items

    def validate_payments(self, payments):
        # Payments may be empty for a fully-on-credit sale (a customer is required,
        # enforced in the checkout service).
        return payments

    def validate_customer(self, customer):
        shop = self.context.get("active_shop")
        if customer is not None and shop is not None and customer.shop_id != shop.id:
            raise serializers.ValidationError("Customer not found in the active shop.")
        return customer


# ---------------------------------------------------------------- output
class SaleItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleItem
        fields = [
            "id",
            "product",
            "name_snapshot",
            "sku_snapshot",
            "unit_price_snapshot",
            "quantity",
            "line_total",
        ]
        read_only_fields = fields


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ["id", "method", "amount", "received_at"]
        read_only_fields = fields


class SaleSerializer(serializers.ModelSerializer):
    items = SaleItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    cashier_email = serializers.EmailField(source="cashier.email", read_only=True, default=None)
    customer_name = serializers.CharField(source="customer.name", read_only=True, default=None)
    amount_paid = serializers.SerializerMethodField()
    change = serializers.SerializerMethodField()

    class Meta:
        model = Sale
        fields = [
            "id",
            "client_uuid",
            "cashier",
            "cashier_email",
            "customer",
            "customer_name",
            "subtotal",
            "discount",
            "tax",
            "total",
            "status",
            "notes",
            "amount_paid",
            "change",
            "items",
            "payments",
            "voided_at",
            "created_at",
        ]
        read_only_fields = fields

    def _paid(self, sale) -> int:
        return sum(p.amount for p in sale.payments.all())

    def get_amount_paid(self, sale) -> int:
        return self._paid(sale)

    def get_change(self, sale) -> int:
        return max(0, self._paid(sale) - sale.total)


class ReceiptSerializer(serializers.ModelSerializer):
    """Flattened, display-ready payload for printing (plan §11 Phase 2)."""

    items = SaleItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    shop_name = serializers.CharField(source="shop.name", read_only=True)
    shop_address = serializers.CharField(source="shop.address", read_only=True)
    cashier_name = serializers.CharField(source="cashier.full_name", read_only=True)
    currency = serializers.SerializerMethodField()
    receipt_footer = serializers.SerializerMethodField()
    amount_paid = serializers.SerializerMethodField()
    change = serializers.SerializerMethodField()

    class Meta:
        model = Sale
        fields = [
            "id",
            "shop_name",
            "shop_address",
            "cashier_name",
            "currency",
            "receipt_footer",
            "subtotal",
            "discount",
            "tax",
            "total",
            "status",
            "amount_paid",
            "change",
            "items",
            "payments",
            "created_at",
        ]
        read_only_fields = fields

    def _settings(self, sale):
        return getattr(sale.shop, "settings", None)

    def get_currency(self, sale) -> str:
        s = self._settings(sale)
        return s.currency if s else "ETB"

    def get_receipt_footer(self, sale) -> str:
        s = self._settings(sale)
        return s.receipt_footer if s else ""

    def get_amount_paid(self, sale) -> int:
        return sum(p.amount for p in sale.payments.all())

    def get_change(self, sale) -> int:
        return max(0, self.get_amount_paid(sale) - sale.total)
