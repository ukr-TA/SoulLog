from django.contrib.auth.password_validation import validate_password
from django.core.validators import validate_email
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import User


class RegisterSerializer(serializers.ModelSerializer):
    """
    What Signup.tsx sends: { fullname, username, email, password, phone_number }.

    The sign-up form always had a phone number field, and it used to be
    dropped before the request was sent. It is optional and saved now; it
    stays private unless the user turns on "Show Phone". The confirm-
    password check is the form's job and is never sent.
    """

    password = serializers.CharField(write_only=True, min_length=8)
    phone_number = serializers.CharField(max_length=32, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ["fullname", "username", "email", "password", "phone_number"]

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("That username is already taken.")
        return value

    def validate_email(self, value):
        try:
            validate_email(value)
        except DjangoValidationError:
            raise serializers.ValidationError("Enter a valid email address.")
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with that email already exists.")
        return value

    def validate_password(self, value):
        # Uses Django's built-in password validators (min length, not
        # entirely numeric, not too common, not too similar to the
        # username) — configured in settings.AUTH_PASSWORD_VALIDATORS.
        validate_password(value)
        return value

    def create(self, validated_data):
        # Note: the profile row itself is created by users.signals.ensure_profile_exists
        # (fired on User post_save) — not here. An earlier version also created it
        # explicitly in both places, which raced against the signal and threw an
        # IntegrityError on every signup. One source of truth now.
        return User.objects.create_user(
            username=validated_data["username"],
            email=validated_data["email"],
            fullname=validated_data.get("fullname", ""),
            password=validated_data["password"],
            phone_number=(validated_data.get("phone_number") or "").strip(),
        )


class UserSerializer(serializers.ModelSerializer):
    """Safe representation of the current user for /auth/me — never
    includes the password hash or anything sensitive."""

    class Meta:
        model = User
        fields = ["id", "username", "email", "fullname", "phone_number", "created_at"]
        read_only_fields = fields
