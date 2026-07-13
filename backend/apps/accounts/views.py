from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import (
    AuthenticationFailed,
    NotFound,
    PermissionDenied,
    ValidationError,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.activity.services import log_activity
from apps.common.permissions import IsOwner
from apps.common.utils import get_client_ip

from .models import Role, User
from .serializers import (
    LogoutSerializer,
    MeSerializer,
    StaffCreateSerializer,
    StaffSerializer,
    StaffUpdateSerializer,
    TokenPairSerializer,
)


class LoginView(TokenObtainPairView):
    """POST /auth/login — returns {access, refresh, user}. Records IP + activity.
    Rate-limited to blunt credential-stuffing (plan §14)."""

    serializer_class = TokenPairSerializer
    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        ip = get_client_ip(request)
        try:
            serializer.is_valid(raise_exception=True)
        except (AuthenticationFailed, TokenError):
            email = request.data.get("email")
            log_activity(
                user=None,
                action="auth.login_failed",
                entity_type="user",
                metadata={"email": email},
                ip=ip,
            )
            from apps.notifications.services import notify_failed_login

            if email:
                notify_failed_login(email, ip)
            raise

        user = serializer.user
        if ip and user.last_login_ip != ip:
            user.last_login_ip = ip
            user.save(update_fields=["last_login_ip", "updated_at"])
        log_activity(
            user=user,
            action="auth.login",
            entity_type="user",
            entity_id=user.id,
            ip=ip,
        )
        return Response(serializer.validated_data, status=status.HTTP_200_OK)


class MeView(generics.RetrieveAPIView):
    """GET /me — profile + memberships + per-shop role."""

    serializer_class = MeSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user


class LogoutView(generics.GenericAPIView):
    """POST /auth/logout — blacklist the supplied refresh token."""

    serializer_class = LogoutSerializer
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={205: None})
    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            RefreshToken(serializer.validated_data["refresh"]).blacklist()
        except TokenError as exc:
            raise ValidationError({"refresh": "Invalid or expired refresh token."}) from exc

        log_activity(
            user=request.user,
            action="auth.logout",
            entity_type="user",
            entity_id=request.user.id,
            ip=get_client_ip(request),
        )
        return Response(status=status.HTTP_205_RESET_CONTENT)


# ------------------------------------------------------------- staff (v2 §3)
class StaffViewSet(viewsets.ModelViewSet):
    """Owner-only staff management: create accounts, assign them to owned
    branches, deactivate, and reset passwords. There is no destroy — accounts
    are deactivated, never hard-deleted, so their audit trail survives.
    """

    permission_classes = [IsAuthenticated, IsOwner]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    search_fields = ["full_name", "email"]
    ordering_fields = ["full_name", "email", "created_at"]
    ordering = ["full_name"]

    def get_serializer_class(self):
        if self.action == "create":
            return StaffCreateSerializer
        if self.action == "partial_update":
            return StaffUpdateSerializer
        return StaffSerializer

    def _owned_shops(self):
        # Local import avoids an accounts -> shops cycle at module load.
        from apps.shops.models import Shop

        return Shop.objects.filter(owner=self.request.user, deleted_at__isnull=True)

    def _owned_shop_ids(self) -> set:
        return set(self._owned_shops().values_list("id", flat=True))

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # schema generation
            return User.objects.none()
        return (
            User.objects.filter(memberships__shop__in=self._owned_shops())
            .prefetch_related("memberships__shop", "memberships__role")
            .distinct()
        )

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if not getattr(self, "swagger_fake_view", False):
            ctx["owned_shop_ids"] = self._owned_shop_ids()
        return ctx

    def _guard_manageable(self, target: User):
        """An owner may only modify users whose access lies entirely within
        their own branches — and never their own account through this API."""
        if target.pk == self.request.user.pk:
            raise PermissionDenied("You can't modify your own account here.")
        if target.owned_shops.exists():
            raise PermissionDenied("This user owns branches and can't be managed here.")
        owned = self._owned_shop_ids()
        foreign = [m for m in target.memberships.all() if m.shop_id not in owned]
        if foreign:
            raise PermissionDenied(
                "This user also works in branches you don't own, so only their owner can manage them."
            )

    def _log(self, action_name, target, metadata=None, level="info"):
        log_activity(
            user=self.request.user,
            action=action_name,
            entity_type="user",
            entity_id=target.id,
            metadata=metadata or {},
            level=level,
            ip=get_client_ip(self.request),
        )

    def _staff_payload(self, user_pk) -> dict:
        # Fetch outside the owned-shops filter: a user whose last assignment
        # was just removed must still serialize for the response.
        user = User.objects.prefetch_related("memberships__shop", "memberships__role").get(
            pk=user_pk
        )
        return StaffSerializer(user, context=self.get_serializer_context()).data

    @extend_schema(request=StaffCreateSerializer, responses={201: StaffSerializer})
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from apps.shops.models import ShopMembership

        with transaction.atomic():
            user = User.objects.create_user(
                email=data["email"], password=data["password"], full_name=data["full_name"]
            )
            for m in data["memberships"]:
                role, _ = Role.objects.get_or_create(name=m["role"])
                ShopMembership.objects.create(user=user, shop_id=m["shop"], role=role)
        self._log(
            "staff.create",
            user,
            {"email": user.email, "branches": [str(m["shop"]) for m in data["memberships"]]},
        )
        return Response(self._staff_payload(user.pk), status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        target = self.get_object()
        self._guard_manageable(target)
        serializer = self.get_serializer(target, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        changed = sorted(k for k in data.keys() if k != "password")
        for field in ("full_name", "email", "is_active"):
            if field in data:
                setattr(target, field, data[field])
        if "password" in data:
            target.set_password(data["password"])
            changed.append("password")
        target.save()

        level = "warn" if data.get("is_active") is False or "password" in data else "info"
        self._log("staff.update", target, {"changed": changed}, level=level)
        return Response(self._staff_payload(target.pk))

    @extend_schema(request=None, responses={200: StaffSerializer})
    @action(detail=True, methods=["post"], url_path="memberships")
    def add_membership(self, request, pk=None):
        target = self.get_object()
        self._guard_manageable(target)

        from apps.shops.models import Shop, ShopMembership

        shop_id = request.data.get("shop")
        role_name = request.data.get("role")
        if role_name not in Role.Name.values:
            raise ValidationError({"role": "Choose a valid role."})
        shop = Shop.objects.filter(id=shop_id, owner=request.user, deleted_at__isnull=True).first()
        if shop is None:
            raise NotFound("Branch not found.")

        membership, created = ShopMembership.objects.get_or_create(
            user=target, shop=shop, defaults={"role": Role.objects.get_or_create(name=role_name)[0]}
        )
        if not created:
            # Same branch, new role — treat as a role change.
            membership.role = Role.objects.get_or_create(name=role_name)[0]
            membership.save(update_fields=["role", "updated_at"])
        self._log("staff.membership_add", target, {"shop": str(shop.id), "role": role_name})
        return Response(self._staff_payload(target.pk))

    @extend_schema(request=None, responses={200: StaffSerializer})
    @action(
        detail=True,
        methods=["delete"],
        url_path=r"memberships/(?P<membership_id>[^/]+)",
    )
    def remove_membership(self, request, pk=None, membership_id=None):
        target = self.get_object()
        self._guard_manageable(target)

        from apps.shops.models import ShopMembership

        membership = ShopMembership.objects.filter(
            id=membership_id, user=target, shop__owner=request.user
        ).first()
        if membership is None:
            raise NotFound("Branch assignment not found.")
        shop_id = membership.shop_id
        membership.delete()
        self._log("staff.membership_remove", target, {"shop": str(shop_id)}, level="warn")
        return Response(self._staff_payload(target.pk))
