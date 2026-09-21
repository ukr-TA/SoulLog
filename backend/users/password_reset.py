from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import serializers

from .models import User


class PasswordResetRequestSerializer(serializers.Serializer):
    """
    Matches ForgotPassword.tsx's form: just a username.

    Deliberately has no validate_username uniqueness/existence check —
    per spec §13, this endpoint must never reveal whether a username
    exists. The view always returns the same generic success response
    regardless of what's found.
    """
    username = serializers.CharField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_new_password(self, value):
        validate_password(value)
        return value

    def validate(self, attrs):
        try:
            user_id = force_str(urlsafe_base64_decode(attrs["uid"]))
            user = User.objects.get(pk=user_id)
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            # Same generic error whether the uid was garbage or the token
            # was wrong — don't help an attacker distinguish the two.
            raise serializers.ValidationError("This password reset link is invalid or has expired.")

        if not default_token_generator.check_token(user, attrs["token"]):
            raise serializers.ValidationError("This password reset link is invalid or has expired.")

        attrs["user"] = user
        return attrs


def make_reset_token(user):
    """Shared by the view and by tests — uid+token pair for a user."""
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return uid, token
