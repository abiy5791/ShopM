from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import User


class TokenPairSerializer(TokenObtainPairSerializer):
    """JWT login. Adds profile claims and a `user` block to the response."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["full_name"] = user.full_name
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "full_name", "is_active"]
        read_only_fields = fields


class MembershipBriefSerializer(serializers.Serializer):
    shop_id = serializers.UUIDField()
    shop_name = serializers.CharField()
    role = serializers.CharField()


class MeSerializer(serializers.ModelSerializer):
    memberships = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "is_active", "is_staff", "memberships"]
        read_only_fields = fields

    def get_memberships(self, user):
        # Imported lazily to avoid an accounts -> shops import cycle at module load.
        from apps.shops.models import ShopMembership

        memberships = (
            ShopMembership.objects.select_related("shop", "role")
            .filter(user=user, shop__deleted_at__isnull=True)
            .order_by("shop__name")
        )
        return [
            {
                "shop_id": m.shop_id,
                "shop_name": m.shop.name,
                "role": m.role.name,
            }
            for m in memberships
        ]


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()
