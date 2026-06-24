from rest_framework import serializers

from .models import Customer


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = [
            "id",
            "name",
            "phone",
            "address",
            "notes",
            "credit_balance_cached",
            "created_at",
        ]
        read_only_fields = ["id", "credit_balance_cached", "created_at"]


class CustomerPaymentSerializer(serializers.Serializer):
    """Input for POST /payments — settle a customer's credit."""

    customer = serializers.PrimaryKeyRelatedField(queryset=Customer.objects.all())
    method = serializers.ChoiceField(choices=["cash", "bank", "mobile_money"])
    amount = serializers.IntegerField(min_value=1)

    def validate_customer(self, customer):
        shop = self.context.get("active_shop")
        if shop is not None and customer.shop_id != shop.id:
            raise serializers.ValidationError("Customer not found in the active shop.")
        return customer
