from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import Shop, ShopSettings


class ShopSerializer(serializers.ModelSerializer):
    my_role = serializers.SerializerMethodField()

    class Meta:
        model = Shop
        fields = ["id", "name", "address", "phone", "my_role", "created_at"]
        read_only_fields = fields

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_my_role(self, shop):
        request = self.context.get("request")
        if not request:
            return None
        # Memberships are prefetched for the current user in the viewset.
        for membership in shop.memberships.all():
            if membership.user_id == request.user.id:
                return membership.role.name
        return None


class ShopSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShopSettings
        fields = [
            "currency",
            "tax_rate",
            "logo_url",
            "receipt_footer",
            "low_stock_default",
            "language",
            "timezone",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]
