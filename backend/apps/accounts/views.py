from drf_spectacular.utils import extend_schema
from rest_framework import generics, status
from rest_framework.exceptions import AuthenticationFailed, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.activity.services import log_activity
from apps.common.utils import get_client_ip

from .serializers import LogoutSerializer, MeSerializer, TokenPairSerializer


class LoginView(TokenObtainPairView):
    """POST /auth/login — returns {access, refresh, user}. Records IP + activity."""

    serializer_class = TokenPairSerializer
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        ip = get_client_ip(request)
        try:
            serializer.is_valid(raise_exception=True)
        except (AuthenticationFailed, TokenError):
            log_activity(
                user=None,
                action="auth.login_failed",
                entity_type="user",
                metadata={"email": request.data.get("email")},
                ip=ip,
            )
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
