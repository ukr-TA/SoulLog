"""
Profile endpoints.

Three screens existed in the codebase with nothing behind them, two of
which were never even reachable from the app:

  Profile.tsx           your own profile page
  ProfileForm           new-user onboarding ("Complete profile / Skip for now")
  ProfileOthersView     someone else's profile

They are backed here. Avatar and cover uploads go through `core.uploads`
like every other file, and the *old* image is deleted when a new one
replaces it — otherwise every avatar change leaves a copy of someone's
face in storage forever, which is both a cost and a quiet privacy problem.

Reading someone else's profile enforces `profile_visibility` in the view
as well as in the serializer. That duplication is deliberate: the
serializer is also used inside feeds, and one of the two has to be the
place that says "no" for a direct fetch.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count, Q
from rest_framework import permissions
from rest_framework.generics import get_object_or_404
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core.uploads import UploadKind, validate_upload

from .models import User
from .public import PublicUserSerializer, cover_url


def _profile_stats(user, viewer):
    """
    The counts a profile page shows. Every one is a real query, and each is
    scoped to what the *viewer* may see — someone looking at a profile does
    not learn how many private entries that person keeps.
    """
    from journal.models import JournalEntry
    from sanctuary.models import SanctuaryPost
    from social.relations import are_connected, connected_user_ids

    is_self = viewer.id == user.id

    entries = JournalEntry.objects.filter(owner=user, is_deleted=False)
    if not is_self:
        if are_connected(viewer, user):
            entries = entries.filter(visibility__in=["community", "connections"])
        else:
            entries = entries.filter(visibility="community")

    posts = SanctuaryPost.objects.filter(author=user, is_deleted=False)
    if not is_self:
        if are_connected(viewer, user):
            posts = posts.filter(visibility__in=[SanctuaryPost.PUBLIC, SanctuaryPost.CONNECTIONS])
        else:
            posts = posts.filter(visibility=SanctuaryPost.PUBLIC)

    from achievements.services import best_streak, reactions_received

    stats = {
        "entries": entries.count(),
        "posts": posts.count(),
        "connections": len(connected_user_ids(user)),
        "followers": user.followers.count(),
        "following": user.following.count(),
        # Reactions other people gave to this person's work. Public,
        # because every one of them is already visible on the thing it
        # was given to — this is just the sum.
        "reactionsReceived": reactions_received(user),
    }

    if is_self:
        from moods.models import MoodCheckIn

        from .profile_views_service import view_count

        stats["moodCheckins"] = MoodCheckIn.objects.filter(owner=user).count()
        stats["privateEntries"] = JournalEntry.objects.filter(
            owner=user, is_deleted=False, visibility="private"
        ).count()
        stats["bestStreak"] = best_streak(user)
        # Only ever on your own profile, and 0 unless you've opted in.
        stats["profileViews"] = view_count(user)

    return stats


class MyProfileView(APIView):
    """
    GET   /api/v1/profile/        — the caller's own profile, in full
    PATCH /api/v1/profile/        — update it (multipart for images)

    This is what backs both `Profile.tsx` and the `ProfileForm` onboarding
    component. `onboarding_completed` is set the first time a profile is
    saved with any real content, which is how the app knows whether to show
    the "Complete your profile" step — rather than a separate flag the
    client sets and could get wrong.
    """

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, *APIView.parser_classes]

    def get(self, request):
        data = PublicUserSerializer(
            request.user, context={"request": request, "viewer": request.user}
        ).data
        profile = request.user.profile
        from achievements.services import progress_for, summary_for

        data.update({
            "stats": _profile_stats(request.user, request.user),
            "onboardingCompleted": profile.onboarding_completed,
            "coverUrl": cover_url(request.user, request),
            "showEmail": profile.show_email,
            "showPhone": profile.show_phone,
            "showProfileViews": profile.show_profile_views,
            "email": request.user.email,
            "phone": request.user.phone_number,
            # Earned badges with the date they were earned, and the next
            # few within reach. Both computed from real activity.
            "achievements": summary_for(request.user),
            "achievementProgress": progress_for(request.user),
        })
        return Response(data)

    def patch(self, request):
        user = request.user
        profile = user.profile

        text_fields = {
            "bio": 2000,
            "location": 120,
            "website": 200,
            "current_focus": 200,
            "growth_areas": 200,
            "values": 200,
        }
        for field, limit in text_fields.items():
            # Accept both snake_case and the camelCase the frontend uses,
            # so neither side has to translate.
            camel = "".join(
                part.capitalize() if index else part
                for index, part in enumerate(field.split("_"))
            )
            if field in request.data or camel in request.data:
                value = request.data.get(field, request.data.get(camel)) or ""
                setattr(profile, field, str(value)[:limit])

        if "fullname" in request.data or "name" in request.data:
            user.fullname = str(request.data.get("fullname", request.data.get("name")))[:150]
            user.save(update_fields=["fullname"])

        if "phone" in request.data or "phone_number" in request.data:
            user.phone_number = str(request.data.get("phone", request.data.get("phone_number")))[:32]
            user.save(update_fields=["phone_number"])

        interests = request.data.get("interests", request.data.get("favorite_topics"))
        if interests is not None:
            if isinstance(interests, str):
                interests = [i.strip() for i in interests.split(",") if i.strip()]
            profile.favorite_topics = [str(i)[:60] for i in list(interests)[:20]]

        for boolean_field, key in (
            ("show_email", "showEmail"),
            ("show_phone", "showPhone"),
            ("mentor_available", "mentorAvailable"),
            ("show_profile_views", "showProfileViews"),
        ):
            if boolean_field in request.data or key in request.data:
                raw = request.data.get(boolean_field, request.data.get(key))
                setattr(profile, boolean_field, str(raw).lower() in ("1", "true", "yes", "on"))

        for choice_field, key, allowed in (
            ("profile_visibility", "profileVisibility", {"public", "connections", "private"}),
            ("journal_visibility", "journalVisibility", {"public", "connections", "private"}),
            ("allow_messages", "allowMessages", {"everyone", "connections", "nobody"}),
        ):
            value = request.data.get(choice_field, request.data.get(key))
            if value in allowed:
                setattr(profile, choice_field, value)

        for image_field, allowed_key in (("profile_image", "avatar"), ("cover_image", "cover")):
            uploaded = request.FILES.get(image_field) or request.FILES.get(allowed_key)
            if uploaded is None:
                continue
            try:
                validate_upload(uploaded, allowed_kinds={UploadKind.IMAGE})
            except DjangoValidationError as exc:
                return Response({image_field: exc.messages}, status=400)

            old = getattr(profile, image_field)
            if old:
                # Replace, don't accumulate.
                old.delete(save=False)
            setattr(profile, image_field, uploaded)

        if not profile.onboarding_completed and (
            profile.bio or profile.location or profile.favorite_topics or profile.current_focus
        ):
            profile.onboarding_completed = True

        profile.save()

        return self.get(request)


class ProfileImageDeleteView(APIView):
    """DELETE /api/v1/profile/image/?field=avatar|cover — remove an image
    and the stored file with it."""

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request):
        field = request.query_params.get("field", "avatar")
        attribute = "profile_image" if field == "avatar" else "cover_image"

        profile = request.user.profile
        image = getattr(profile, attribute)
        if image:
            image.delete(save=False)
            setattr(profile, attribute, None)
            profile.save(update_fields=[attribute])

        return Response({"detail": "Image removed."})


class PublicProfileView(APIView):
    """
    GET /api/v1/profile/<username>/ — what `ProfileOthersView` renders.

    A `private` profile, or one belonging to someone who has blocked the
    caller, returns 404. Not 403: "this account exists but you may not see
    it" is more than a private profile agreed to reveal.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, username):
        from django.http import Http404

        from social.relations import are_connected, is_blocked_between

        user = get_object_or_404(
            User.objects.select_related("profile", "app_settings"),
            username__iexact=username,
            is_active=True,
        )

        if user.id != request.user.id:
            if is_blocked_between(user, request.user):
                raise Http404
            visibility = user.profile.profile_visibility
            if visibility == "private":
                raise Http404
            if visibility == "connections" and not are_connected(user, request.user):
                # Identity only — enough for the UI to say "this profile is
                # visible to connections" instead of showing a dead end.
                data = PublicUserSerializer(
                    user, context={"request": request, "viewer": request.user}
                ).data
                data["restricted"] = True
                return Response(data)

        from achievements.services import summary_for

        from .profile_views_service import record_view

        # Recorded only when both people share profile views — the rule
        # lives in record_view() and is enforced on write, not on read.
        record_view(request.user, user)

        data = PublicUserSerializer(
            user, context={"request": request, "viewer": request.user}
        ).data
        data["restricted"] = False
        data["stats"] = _profile_stats(user, request.user)
        data["achievements"] = summary_for(user, viewer=request.user)
        return Response(data)


class PublicProfilePostsView(APIView):
    """
    GET /api/v1/profile/<username>/posts/

    The Sanctuary posts and shared journal entries of one person, filtered
    by exactly the same visibility rules the feed uses — by calling the
    feed's own queryset rather than reimplementing it.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, username):
        from sanctuary.serializers import serialize_post
        from sanctuary.views import _interaction_sets, visible_posts

        user = get_object_or_404(User, username__iexact=username, is_active=True)

        limit = min(int(request.query_params.get("limit", 20)), 50)
        offset = max(int(request.query_params.get("offset", 0)), 0)

        queryset = visible_posts(request.user).filter(author=user)
        total = queryset.count()
        posts = list(queryset[offset:offset + limit])
        liked, bookmarked = _interaction_sets(request.user, posts)

        return Response({
            "posts": [
                serialize_post(post, request.user, liked, bookmarked, request) for post in posts
            ],
            "total": total,
            "hasMore": offset + len(posts) < total,
        })


class MentorDirectoryView(APIView):
    """
    GET /api/v1/profile/mentors/

    Everyone who has switched on "available to mentor" in Settings. That
    toggle has existed since the beginning and nothing read it; this is
    what it now does.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from social.relations import blocked_user_ids

        users = (
            User.objects.filter(profile__mentor_available=True, is_active=True)
            .exclude(id__in=blocked_user_ids(request.user) | {request.user.id})
            .exclude(profile__profile_visibility="private")
            .select_related("profile", "app_settings")
            .annotate(connection_count=Count("connections_received", filter=Q(
                connections_received__status="accepted"
            )))
            .order_by("-connection_count")[:50]
        )
        return Response(
            PublicUserSerializer(
                users, many=True, context={"request": request, "viewer": request.user}
            ).data
        )


class ProfileViewersView(APIView):
    """
    GET /api/v1/profile/views/ — who has looked at your profile.

    Returns an empty list and `enabled: false` when you have profile
    views switched off, because with it off nothing is being recorded.
    That's the reciprocal bargain: see and be seen, or neither.

    Only ever your own viewers. There is no endpoint for reading anyone
    else's, and there shouldn't be.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from .models import ProfileView
        from .profile_views_service import view_count, viewers_for

        enabled = request.user.profile.show_profile_views
        return Response({
            "enabled": enabled,
            "count": view_count(request.user),
            "retentionDays": ProfileView.RETENTION_DAYS,
            "viewers": viewers_for(request.user, request),
        })


class MyAchievementsView(APIView):
    """
    GET /api/v1/profile/achievements/

    Earned badges with real dates, plus the next few within reach.
    Re-checks on read, so a badge earned by activity that happened
    outside the app's own write paths (an import, a fixture) still
    appears rather than waiting for the next entry.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from achievements.services import award_quietly, progress_for, summary_for

        award_quietly(request.user)
        return Response({
            "earned": summary_for(request.user),
            "next": progress_for(request.user),
        })
