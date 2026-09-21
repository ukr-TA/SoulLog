from django.contrib.auth.password_validation import validate_password
from rest_framework import permissions, serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import UserProfile, UserSettings


def _visibility_to_frontend(value):
    # Settings.tsx's own vocabulary is 'friends', not 'connections' —
    # same translation-at-the-boundary pattern as the Journal share modal
    # (Milestone 6), kept consistent rather than renaming either side.
    return "friends" if value == "connections" else value


def _visibility_to_backend(value):
    return "connections" if value == "friends" else value


class SettingsSerializer(serializers.Serializer):
    """
    Not a ModelSerializer — this assembles/updates fields that live across
    three different models (User, UserProfile, UserSettings) into the one
    nested shape Settings.tsx's `settings` state already uses, so the
    frontend needs no restructuring.
    """

    # --- profile (User + UserProfile) ---
    profile = serializers.DictField(required=False)
    # --- privacy (UserProfile) ---
    privacy = serializers.DictField(required=False)
    # --- notifications / journaling / social / appearance (UserSettings JSON) ---
    notifications = serializers.DictField(required=False)
    journaling = serializers.DictField(required=False)
    social = serializers.DictField(required=False)
    appearance = serializers.DictField(required=False)

    @staticmethod
    def to_representation(user):
        profile = user.profile
        app_settings = user.app_settings
        return {
            "profile": {
                "name": user.fullname,
                "bio": profile.bio,
                "email": user.email,
                "phone": user.phone_number,
                "location": profile.location,
                "website": profile.website,
            },
            "privacy": {
                "profileVisibility": profile.profile_visibility,
                "journalVisibility": _visibility_to_frontend(profile.journal_visibility),
                "showEmail": profile.show_email,
                "showPhone": profile.show_phone,
                # Reciprocal by design: see who viewed you, and be seen
                # when you view others. With it off, neither is recorded.
                "showProfileViews": profile.show_profile_views,
                "allowMessages": profile.allow_messages,
                "mentorAvailable": profile.mentor_available,
            },
            "notifications": app_settings.notifications,
            "journaling": app_settings.journaling,
            "social": app_settings.social,
            "appearance": app_settings.appearance,
        }

    def update_user(self, user, validated_data):
        profile = user.profile
        app_settings = user.app_settings

        if "profile" in validated_data:
            p = validated_data["profile"]
            if "name" in p:
                user.fullname = p["name"]
            if "phone" in p:
                user.phone_number = p["phone"]
            # Email intentionally NOT updatable here — changing the
            # login-identifying email deserves its own verified flow
            # (spec §12/§13 territory), not a silent settings-form edit.
            if "bio" in p:
                profile.bio = p["bio"]
            if "location" in p:
                profile.location = p["location"]
            if "website" in p:
                profile.website = p["website"]
            user.save(update_fields=["fullname", "phone_number"])

        if "privacy" in validated_data:
            pr = validated_data["privacy"]
            if "profileVisibility" in pr:
                profile.profile_visibility = pr["profileVisibility"]
            if "journalVisibility" in pr:
                profile.journal_visibility = _visibility_to_backend(pr["journalVisibility"])
            if "showEmail" in pr:
                profile.show_email = bool(pr["showEmail"])
            if "showPhone" in pr:
                profile.show_phone = bool(pr["showPhone"])
            if "showProfileViews" in pr:
                profile.show_profile_views = bool(pr["showProfileViews"])
            if "allowMessages" in pr:
                profile.allow_messages = pr["allowMessages"]
            if "mentorAvailable" in pr:
                profile.mentor_available = bool(pr["mentorAvailable"])

        profile.save()

        for group in ("notifications", "journaling", "social", "appearance"):
            if group in validated_data:
                current = getattr(app_settings, group) or {}
                current.update(validated_data[group])
                setattr(app_settings, group, current)
        app_settings.save()

        return user


class SettingsView(APIView):
    """GET/PATCH /api/v1/settings/ — real persistence for Settings.tsx
    (spec §53-58). Previously handleSave just flashed a 'saved' UI state
    for 2 seconds without writing anything anywhere."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(SettingsSerializer.to_representation(request.user))

    def patch(self, request):
        serializer = SettingsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.update_user(request.user, serializer.validated_data)
        return Response(SettingsSerializer.to_representation(request.user))


class ChangePasswordView(APIView):
    """POST /api/v1/auth/change-password/ — { current_password, new_password }."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        current_password = request.data.get("current_password", "")
        new_password = request.data.get("new_password", "")

        if not request.user.check_password(current_password):
            return Response({"current_password": ["Current password is incorrect."]}, status=400)

        try:
            validate_password(new_password, user=request.user)
        except serializers.ValidationError as exc:
            return Response({"new_password": exc.detail}, status=400)

        request.user.set_password(new_password)
        request.user.save(update_fields=["password"])
        return Response({"detail": "Password changed successfully."})


class DeleteAccountView(APIView):
    """
    DELETE /api/v1/auth/account/ — { password }.

    Requires re-entering the password as the "explicit, deliberate
    confirmation" spec §59/§101 calls for, on top of the frontend's own
    two-step confirm button. Cascading deletes (journal entries, comments,
    reactions, mood check-ins, profile, settings) all happen automatically
    via on_delete=CASCADE on every FK to User — no separate cleanup code
    needed, and nothing is silently orphaned.
    """

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request):
        if not request.user.check_password(request.data.get("password", "")):
            return Response({"password": ["Password is incorrect."]}, status=400)
        request.user.delete()
        return Response({"detail": "Account deleted."}, status=200)


class ExportDataView(APIView):
    """
    GET /api/v1/users/export/ — spec §59's "Export My Data" button.

    Returns the user's own journal entries and mood check-ins as JSON.
    Deliberately excludes other users' comments on the user's entries
    (that's someone else's content) and excludes the password hash and
    any other auth internals.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from journal.models import JournalEntry
        from journal.views import JournalEntrySerializer
        from moods.models import MoodCheckIn
        from moods.views import MoodCheckInSerializer

        entries = JournalEntry.objects.filter(owner=request.user, is_deleted=False)
        checkins = MoodCheckIn.objects.filter(owner=request.user)

        return Response({
            "username": request.user.username,
            "email": request.user.email,
            "fullname": request.user.fullname,
            "journal_entries": JournalEntrySerializer(entries, many=True).data,
            "mood_checkins": MoodCheckInSerializer(checkins, many=True).data,
        })
