from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import Role, User


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


# ------------------------------------------------------------- staff (v2 §3)
def _validate_password_strength(value: str) -> str:
    try:
        validate_password(value)
    except DjangoValidationError as exc:
        raise serializers.ValidationError(list(exc.messages)) from exc
    return value


class StaffMembershipSerializer(serializers.Serializer):
    """One branch assignment of a staff member (read shape)."""

    id = serializers.UUIDField(read_only=True)
    shop_id = serializers.UUIDField(read_only=True)
    shop_name = serializers.CharField(source="shop.name", read_only=True)
    role = serializers.CharField(source="role.name", read_only=True)


class StaffSerializer(serializers.ModelSerializer):
    """A user managed by the calling owner. ``memberships`` only includes
    branches the caller owns — assignments elsewhere are not their business."""

    memberships = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "full_name",
            "is_active",
            "last_login",
            "created_at",
            "memberships",
        ]
        read_only_fields = fields

    @property
    def _owned_shop_ids(self) -> set:
        return self.context.get("owned_shop_ids", set())

    def get_memberships(self, user) -> list[dict]:
        memberships = [m for m in user.memberships.all() if m.shop_id in self._owned_shop_ids]
        return StaffMembershipSerializer(memberships, many=True).data


class StaffMembershipInputSerializer(serializers.Serializer):
    shop = serializers.UUIDField()
    role = serializers.ChoiceField(choices=Role.Name.choices)


class StaffCreateSerializer(serializers.Serializer):
    """Owner creates a staff account with at least one branch assignment."""

    full_name = serializers.CharField(max_length=255)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, validators=[_validate_password_strength])
    memberships = StaffMembershipInputSerializer(many=True)

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value.lower()

    def validate_memberships(self, value):
        if not value:
            raise serializers.ValidationError("Assign the staff member to at least one branch.")
        shop_ids = [m["shop"] for m in value]
        if len(shop_ids) != len(set(shop_ids)):
            raise serializers.ValidationError("Duplicate branch assignments.")
        owned = self.context["owned_shop_ids"]
        if any(sid not in owned for sid in shop_ids):
            raise serializers.ValidationError("Branch not found.")
        return value


class StaffUpdateSerializer(serializers.Serializer):
    """Partial update: profile fields, activation, or an owner-set new password."""

    full_name = serializers.CharField(max_length=255, required=False)
    email = serializers.EmailField(required=False)
    is_active = serializers.BooleanField(required=False)
    password = serializers.CharField(
        write_only=True, required=False, validators=[_validate_password_strength]
    )

    def validate_email(self, value):
        qs = User.objects.filter(email__iexact=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value.lower()
