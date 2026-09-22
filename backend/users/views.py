from django.conf import settings
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import User
from .password_reset import (
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    make_reset_token,
)
from .serializers import RegisterSerializer, UserSerializer


class RegisterView(generics.CreateAPIView):
    """POST /api/v1/auth/register — matches Signup.tsx exactly."""

    permission_classes = [permissions.AllowAny]
    serializer_class = RegisterSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # Signup.tsx only checks `response.ok` and doesn't read the body,
        # so we keep this minimal rather than leaking user internals.
        return Response({"detail": "Account created successfully."}, status=status.HTTP_201_CREATED)


class SoulLogTokenObtainSerializer(TokenObtainPairSerializer):
    """
    simplejwt returns {"access": ..., "refresh": ...} by default.

    Signin.tsx already expects a specific shape —
    { access_token, refresh_token, token_type, expires_in } — because that
    was the contract the frontend was originally built against. Rather than
    rewrite working, tested frontend code, we reshape the response here.
    """

    def validate(self, attrs):
        data = super().validate(attrs)
        access_lifetime = settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"]
        return {
            "access_token": data["access"],
            "refresh_token": data["refresh"],
            "token_type": "bearer",
            "expires_in": int(access_lifetime.total_seconds()),
        }


class LoginView(TokenObtainPairView):
    """POST /api/v1/auth/login — matches Signin.tsx exactly."""

    permission_classes = [permissions.AllowAny]
    serializer_class = SoulLogTokenObtainSerializer


class MeView(APIView):
    """GET /api/v1/auth/me — the authenticated user's own (safe) profile."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class PasswordResetRequestView(APIView):
    """
    POST /api/v1/auth/password-reset/request/ — matches ForgotPassword.tsx.

    Security-critical (spec §13): ALWAYS returns the same generic response,
    whether or not the username exists, so this endpoint can't be used to
    enumerate real accounts. Only sends an email (dev: console backend —
    see spec §88) when the user is actually found.
    """

    permission_classes = [permissions.AllowAny]

    GENERIC_RESPONSE = {
        "detail": "If an account with that username exists, a password reset link has been sent to its email address."
    }

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        username = serializer.validated_data["username"]

        try:
            user = User.objects.get(username__iexact=username)
        except User.DoesNotExist:
            return Response(self.GENERIC_RESPONSE)

        uid, token = make_reset_token(user)
        from django.core.mail import send_mail
        from django.conf import settings as django_settings

        # A link that opens the reset screen with both codes filled in.
        # The email used to contain only the raw uid and token and ask the
        # user to copy them into the app by hand. The codes are still
        # included, for the phone app, where a web link can't open it.
        link = f"{django_settings.FRONTEND_BASE_URL.rstrip('/')}/#/reset-password/{uid}/{token}"
        send_mail(
            subject="Reset your SoulLog password",
            message=(
                "Someone (hopefully you) asked to reset the password for your SoulLog account.\n\n"
                f"Choose a new password here:\n{link}\n\n"
                "Using the SoulLog phone app? Enter these on the reset screen instead:\n"
                f"uid: {uid}\ntoken: {token}\n\n"
                "If you didn't ask for this, you can ignore this email — your password won't change."
            ),
            from_email=None,
            recipient_list=[user.email],
            fail_silently=True,
        )
        return Response(self.GENERIC_RESPONSE)


class PasswordResetConfirmView(APIView):
    """POST /api/v1/auth/password-reset/confirm/ — { uid, token, new_password }.
    Setting a new password naturally invalidates the token (Django's
    default_token_generator ties the token to the current password hash),
    so no separate 'used' bookkeeping is needed."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])
        return Response({"detail": "Your password has been reset. You can now sign in."})


class HealthView(APIView):
    """
    GET /healthz — for the load balancer, not for humans.

    Checks the one dependency whose absence makes every other endpoint
    fail (the database) and returns 503 when it's unreachable, so an
    orchestrator pulls the instance out of rotation instead of serving
    500s. Deliberately reveals nothing about the deployment.
    """

    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request):
        from django.db import connection

        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
        except Exception:  # noqa: BLE001
            return Response({"status": "unhealthy"}, status=503)

        return Response({"status": "ok"})
