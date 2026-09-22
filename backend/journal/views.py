from datetime import timedelta

from django.utils import timezone
from rest_framework import generics, permissions, serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import JournalEntry, JournalMedia


class JournalMediaSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = JournalMedia
        fields = ["id", "url", "kind", "mime_type", "size_bytes", "duration_seconds", "caption"]
        read_only_fields = fields

    def get_url(self, obj):
        request = self.context.get("request")
        url = obj.file.url
        return request.build_absolute_uri(url) if request else url


class JournalEntrySerializer(serializers.ModelSerializer):
    media = JournalMediaSerializer(many=True, read_only=True)

    # The Journal card's footer — heart count, comment count — appears on
    # shared entries and used to read fields this API never sent, so it
    # showed 0 forever. These four make it real. `shared` is derived from
    # `visibility` rather than stored twice.
    shared = serializers.SerializerMethodField()
    likes = serializers.SerializerMethodField()
    liked = serializers.SerializerMethodField()
    comments = serializers.SerializerMethodField()

    class Meta:
        model = JournalEntry
        fields = [
            "id", "title", "content", "entry_type", "mood", "tags",
            "visibility", "prompt_used", "word_count",
            # Share settings — all four were collected by the UI and
            # discarded before this; they now round-trip like any other field.
            "identity", "include_mood", "include_date", "allow_comments",
            "media", "shared", "likes", "liked", "comments",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "word_count", "media", "shared", "likes", "liked", "comments",
            "created_at", "updated_at",
        ]

    def get_shared(self, obj):
        return obj.visibility != "private"

    def get_likes(self, obj):
        count = getattr(obj, "like_count", None)
        return count if count is not None else obj.reactions.count()

    def get_liked(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        return obj.reactions.filter(user=request.user).exists()

    def get_comments(self, obj):
        count = getattr(obj, "comment_count", None)
        return count if count is not None else obj.comments.count()


class JournalListCreateView(generics.ListCreateAPIView):
    """
    GET/POST /api/v1/journal/

    Security-critical: get_queryset is filtered to `owner=self.request.user`
    at the database level. A logged-in user can never list or fetch another
    user's private entries by changing a URL or query param — per spec §21.

    Paginated with `limit`/`offset`, matching the Sanctuary feed and the
    content library. Two notes on why searching and sorting moved to the
    server at the same time:

      * Filtering a page instead of a table is worse than not filtering.
        Journal.tsx used to search the array it had; once that array is
        one page, "search" would quietly mean "search the most recent
        twenty", and a user looking for something they wrote in March
        would be told it doesn't exist.
      * The sort was already broken. It compared `entry.date` and
        `entry.time`, which this API has never returned — every
        comparison was against an Invalid Date, so choosing
        newest/oldest/mood did nothing at all. Sorting in SQL fixes that
        as a side effect of moving it.

    Response shape is `{entries, total, offset, limit, hasMore}` rather
    than a bare array. Journal.tsx was updated in the same change.
    """

    serializer_class = JournalEntrySerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None  # hand-rolled below, to match the other feeds

    DEFAULT_LIMIT = 20
    MAX_LIMIT = 100

    SORTS = {
        "newest": ["-created_at"],
        "oldest": ["created_at"],
        # Mood alphabetically, then newest within each mood, so the
        # grouping is stable rather than arbitrary inside a mood.
        "mood": ["mood", "-created_at"],
    }

    def get_queryset(self):
        from django.db.models import Count, Q

        # Counted in the list query rather than per card: a journal with a
        # hundred entries on screen would otherwise issue two hundred
        # extra queries to draw two small numbers.
        queryset = (
            JournalEntry.objects.filter(owner=self.request.user, is_deleted=False)
            .prefetch_related("media")
            .annotate(
                like_count=Count("reactions", distinct=True),
                comment_count=Count("comments", distinct=True),
            )
        )

        mood = (self.request.query_params.get("mood") or "all").strip()
        if mood and mood != "all":
            queryset = queryset.filter(mood=mood)

        query = (self.request.query_params.get("q") or "").strip()
        if query:
            queryset = queryset.filter(
                Q(title__icontains=query)
                | Q(content__icontains=query)
                | Q(mood__icontains=query)
                | Q(tags__icontains=query)
            )

        sort = self.request.query_params.get("sort", "newest")
        return queryset.order_by(*self.SORTS.get(sort, self.SORTS["newest"]))

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()

        try:
            limit = min(int(request.query_params.get("limit", self.DEFAULT_LIMIT)), self.MAX_LIMIT)
            offset = max(int(request.query_params.get("offset", 0)), 0)
        except (TypeError, ValueError):
            limit, offset = self.DEFAULT_LIMIT, 0

        total = queryset.count()
        page = list(queryset[offset:offset + limit])

        return Response({
            "entries": self.get_serializer(page, many=True).data,
            "total": total,
            "offset": offset,
            "limit": limit,
            "hasMore": offset + len(page) < total,
        })

    def perform_create(self, serializer):
        # An entry saved without saying who can see it gets the user's own
        # default (Settings → Privacy → Journal Visibility), which is
        # private unless they changed it. The profile setting uses the
        # profile's vocabulary, where "public" is the journal's "community".
        extra = {}
        if "visibility" not in self.request.data:
            profile = getattr(self.request.user, "profile", None)
            default = getattr(profile, "journal_visibility", "private") or "private"
            extra["visibility"] = {"public": "community"}.get(default, default)
        serializer.save(owner=self.request.user, **extra)

        # Writing an entry can move the entry count and both streaks, and
        # nothing else. award_quietly never raises, so a badge problem
        # can't cost someone their entry.
        from achievements.models import Badge
        from achievements.services import award_quietly

        award_quietly(
            self.request.user,
            metrics={Badge.ENTRIES, Badge.CURRENT_STREAK, Badge.BEST_STREAK},
        )


class JournalDetailView(generics.RetrieveUpdateDestroyAPIView):
    """GET/PATCH/DELETE /api/v1/journal/<id>/ — owner-only, enforced below."""

    serializer_class = JournalEntrySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Same enforcement as above: this is what actually stops User A
        # from reading/editing/deleting User B's entry by guessing an id.
        return JournalEntry.objects.filter(owner=self.request.user, is_deleted=False)

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted"])


class DashboardStatsView(APIView):
    """
    GET /api/v1/journal/stats/

    Backs the Dashboard's "Total Entries" and "Current Streak" cards with
    real numbers (spec §17 — "Do not hardcode these numbers").

    Streak rule (spec §18 requires this be explicit and documented):
    A day counts as an "active day" if the user created at least one
    JournalEntry OR at least one MoodCheckIn on that calendar day.
    The streak is the number of consecutive active days ending today
    (today itself doesn't have to be active yet — a streak stays alive
    until the user has gone a full day with zero activity).

    Known limitation (honest, not hidden — see docs/NOT-BUILT-OR-DEFERRED.md):
    "calendar day" is currently computed in UTC, not the user's local
    timezone. The User model has no timezone field yet. A user near a
    UTC day boundary could see their streak flip a few hours off from
    their local midnight. Fixing this properly means adding a user
    timezone preference and using it here — deferred, not silently
    worked around.

    "Insights Gained" and "Community Posts" used to be excluded from this
    response because neither system existed and a number would have been a
    guess. Both exist now, so both are returned — `insights_gained` is the
    number of observations the Insight Engine can currently make from this
    user's own data, and `community_posts` counts their live Sanctuary
    posts. Zero is still a perfectly good answer for a new account.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from moods.models import MoodCheckIn  # local import avoids an app-load-order dependency

        user = request.user
        total_entries = JournalEntry.objects.filter(owner=user, is_deleted=False).count()

        journal_dates = set(
            JournalEntry.objects.filter(owner=user, is_deleted=False)
            .values_list("created_at__date", flat=True)
        )
        mood_dates = set(
            MoodCheckIn.objects.filter(owner=user).values_list("created_at__date", flat=True)
        )
        active_dates = journal_dates | mood_dates

        streak = 0
        cursor = timezone.now().date()
        while cursor in active_dates:
            streak += 1
            cursor -= timedelta(days=1)
        # If today has no activity yet, the streak isn't broken until a
        # full day passes with nothing logged — so also check "yesterday
        # onward" when today itself is empty.
        if streak == 0:
            cursor = timezone.now().date() - timedelta(days=1)
            while cursor in active_dates:
                streak += 1
                cursor -= timedelta(days=1)

        from insights.engine import run_insight_engine
        from sanctuary.models import SanctuaryPost

        # Added when the journal list was paginated. The Journal screen's
        # summary tiles used to be counted from the array the list endpoint
        # returned; once that array became one page, counting it there
        # would have silently meant "…on this page". These are counted over
        # the whole journal, which is what the tiles claim to show.
        shared_entries = (
            JournalEntry.objects.filter(owner=user, is_deleted=False)
            .exclude(visibility="private")
            .count()
        )
        likes_received = (
            JournalEntryReaction.objects.filter(entry__owner=user, entry__is_deleted=False)
            .exclude(user=user)
            .count()
        )

        return Response({
            "total_entries": total_entries,
            "shared_entries": shared_entries,
            "likes_received": likes_received,
            "current_streak_days": streak,
            "insights_gained": len(run_insight_engine(user)),
            "community_posts": SanctuaryPost.objects.filter(
                author=user, is_deleted=False
            ).count(),
            "mood_checkins": MoodCheckIn.objects.filter(owner=user).count(),
        })


# --- Comments & reactions ---------------------------------------------------

from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied

from .models import JournalComment, JournalCommentReaction, JournalEntryReaction


def _get_visible_entry(user, entry_id, for_comment=False):
    """
    Shared visibility check for the comment endpoints below.

    The rule, in full:

      private      Owner only.
      connections  Owner, and users with an *accepted* connection to the
                   owner. This used to behave identically to 'community'
                   because no connections system existed — the gap was
                   documented rather than hidden, and it is now closed.
                   Following someone is explicitly not enough: following
                   needs no consent, and consent is the whole point of
                   this setting.
      community    Any authenticated user.

    A block in either direction hides the entry regardless of visibility.

    Everything returns 404 rather than 403 — same as the detail view, and
    for the same reason: a 403 confirms the entry exists.
    """
    from social.relations import are_connected, is_blocked_between

    entry = get_object_or_404(
        JournalEntry.objects.select_related("owner"), pk=entry_id, is_deleted=False
    )

    if entry.owner_id == user.id:
        return entry

    if is_blocked_between(entry.owner, user):
        raise Http404

    if entry.visibility == "private":
        raise Http404
    if entry.visibility == "connections" and not are_connected(entry.owner, user):
        raise Http404

    # `allow_comments` is one of the four share settings the UI collected
    # and threw away. Reading the entry is still fine when it's off; only
    # commenting is refused, and with a 403 because the entry's existence
    # is not a secret at this point.
    if for_comment and not entry.allow_comments:
        raise PermissionDenied("The author has turned off comments for this entry.")

    return entry


class CommentSerializer(serializers.ModelSerializer):
    author = serializers.CharField(source="author.username", read_only=True)
    avatar = serializers.SerializerMethodField()
    time = serializers.DateTimeField(source="created_at", format="%b %d, %Y, %I:%M %p", read_only=True)
    hearts = serializers.SerializerMethodField()
    reacted = serializers.SerializerMethodField()
    replies = serializers.SerializerMethodField()
    # camelCase here to match the other three comment payloads (Sanctuary,
    # library, messages), so the UI reads one field name everywhere.
    editedAt = serializers.DateTimeField(source="edited_at", read_only=True)
    isOwn = serializers.SerializerMethodField()

    class Meta:
        model = JournalComment
        fields = [
            "id", "author", "avatar", "time", "content", "hearts", "reacted",
            "replies", "parent", "editedAt", "isOwn",
        ]
        read_only_fields = [
            "id", "author", "avatar", "time", "hearts", "reacted", "replies",
            "editedAt", "isOwn",
        ]
        extra_kwargs = {"parent": {"write_only": True, "required": False}}

    def get_avatar(self, obj):
        return obj.author.username[0].upper() if obj.author.username else "?"

    def get_isOwn(self, obj):  # noqa: N802 — matches the serializer field name
        request = self.context.get("request")
        return bool(request and obj.author_id == getattr(request.user, "id", None))

    def get_hearts(self, obj):
        return obj.reactions.count()

    def get_reacted(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        return obj.reactions.filter(user=request.user).exists()

    def get_replies(self, obj):
        # One level deep only — see JournalComment's docstring.
        if obj.parent_id is not None:
            return []
        return CommentSerializer(obj.replies.all(), many=True, context=self.context).data


class CommentListCreateView(generics.ListCreateAPIView):
    """GET/POST /api/v1/journal/<entry_id>/comments/ — top-level comments,
    each carrying its replies nested inside (see CommentSerializer)."""

    serializer_class = CommentSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None  # see NOTE in JournalListCreateView — same reasoning

    def get_queryset(self):
        entry = _get_visible_entry(self.request.user, self.kwargs["entry_id"])
        return JournalComment.objects.filter(entry=entry, parent__isnull=True).select_related("author")

    def perform_create(self, serializer):
        entry = _get_visible_entry(self.request.user, self.kwargs["entry_id"], for_comment=True)
        parent = serializer.validated_data.get("parent")
        if parent is not None and parent.entry_id != entry.id:
            raise serializers.ValidationError("Reply's parent comment must belong to this entry.")
        comment = serializer.save(entry=entry, author=self.request.user)

        from notifications.services import notify

        notify(
            recipient=entry.owner,
            actor=self.request.user,
            kind="comment",
            title="commented on your entry",
            body=comment.content[:140],
            target=entry,
            target_label=entry.title or entry.content[:60],
        )
        if parent is not None:
            notify(
                recipient=parent.author,
                actor=self.request.user,
                kind="reply",
                title="replied to your comment",
                body=comment.content[:140],
                target=entry,
                target_label=entry.title or entry.content[:60],
                dedupe_key=f"journal-reply:{parent.id}:{self.request.user.id}",
            )


class CommentDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    PATCH/DELETE /api/v1/journal/<entry_id>/comments/<pk>/

    Author-only for both, enforced by the queryset rather than by a check
    inside the handler — someone else's comment isn't merely refused, it
    isn't found. Editing rules live in `core.editing` so they're the same
    here, on Sanctuary comments, on library comments and on messages.
    """

    serializer_class = CommentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return JournalComment.objects.filter(entry_id=self.kwargs["entry_id"], author=self.request.user)

    def patch(self, request, *args, **kwargs):
        from core.editing import apply_edit, check_editable, clean_text

        comment = self.get_object()
        check_editable(comment, request.user)
        apply_edit(comment, clean_text(request.data.get("content"), max_length=2000))

        return Response(self.get_serializer(comment).data)

    def put(self, request, *args, **kwargs):
        return self.patch(request, *args, **kwargs)


class CommentReactView(APIView):
    """POST /api/v1/journal/<entry_id>/comments/<comment_id>/react/ —
    toggles the requesting user's heart on a comment (add if absent,
    remove if already reacted)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, entry_id, comment_id):
        _get_visible_entry(request.user, entry_id)
        comment = get_object_or_404(JournalComment, pk=comment_id, entry_id=entry_id)
        reaction, created = JournalCommentReaction.objects.get_or_create(comment=comment, user=request.user)
        if not created:
            reaction.delete()
            reacted = False
        else:
            reacted = True
        return Response({"reacted": reacted, "hearts": comment.reactions.count()})


class EntryReactView(APIView):
    """
    POST /api/v1/journal/<entry_id>/react/ — toggle your heart on a shared
    entry.

    Visibility is checked with the same helper the comment endpoints use,
    so an entry you cannot see is an entry you cannot heart, and a private
    entry gets the usual 404 rather than a 403 that would confirm it
    exists. Hearting your own entry is allowed but is excluded from the
    "likes received" figure on the owner's dashboard — a number you can
    raise yourself is not a number worth showing.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, entry_id):
        entry = _get_visible_entry(request.user, entry_id)
        reaction, created = JournalEntryReaction.objects.get_or_create(
            entry=entry, user=request.user
        )
        if not created:
            reaction.delete()
        return Response({"liked": created, "likes": entry.reactions.count()})


# --- Media attachments ------------------------------------------------------

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.parsers import FormParser, MultiPartParser

from core.uploads import UploadKind, validate_upload
from .models import JournalMedia as _JournalMedia

MAX_MEDIA_PER_ENTRY = 6


class JournalMediaView(APIView):
    """
    GET/POST /api/v1/journal/<entry_id>/media/

    This is what makes CreateJournal.tsx's Photo Memory and Voice Note
    buttons real. Both were dead controls: the toolbar rendered them, and
    nothing was behind them.

    Owner-only, deliberately. Attaching a file to someone else's entry is
    not a feature anyone asked for, and the queryset filter here is what
    makes it impossible rather than merely unimplemented.
    """

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, *APIView.parser_classes]

    def _entry(self, request, entry_id):
        return get_object_or_404(
            JournalEntry, pk=entry_id, owner=request.user, is_deleted=False
        )

    def get(self, request, entry_id):
        entry = self._entry(request, entry_id)
        return Response(
            JournalMediaSerializer(entry.media.all(), many=True, context={"request": request}).data
        )

    def post(self, request, entry_id):
        entry = self._entry(request, entry_id)

        uploaded = request.FILES.get("file")
        if uploaded is None:
            return Response({"file": ["No file was uploaded."]}, status=400)

        if entry.media.count() >= MAX_MEDIA_PER_ENTRY:
            return Response(
                {"detail": f"An entry can hold up to {MAX_MEDIA_PER_ENTRY} attachments."},
                status=400,
            )

        try:
            kind, _extension, mime_type = validate_upload(
                uploaded, allowed_kinds={UploadKind.IMAGE, UploadKind.AUDIO}
            )
        except DjangoValidationError as exc:
            return Response({"file": exc.messages}, status=400)

        media = _JournalMedia.objects.create(
            entry=entry,
            file=uploaded,
            kind=kind,
            mime_type=mime_type,
            size_bytes=uploaded.size,
            duration_seconds=int(request.data.get("duration_seconds") or 0),
            caption=(request.data.get("caption") or "")[:300],
        )

        # Keep entry_type consistent with what's actually attached, so the
        # Journal list's photo/voice filters reflect reality rather than
        # whatever the create form happened to send.
        if kind == UploadKind.AUDIO and entry.entry_type == "text":
            entry.entry_type = "voice"
            entry.save(update_fields=["entry_type"])
        elif kind == UploadKind.IMAGE and entry.entry_type == "text":
            entry.entry_type = "photo"
            entry.save(update_fields=["entry_type"])

        return Response(
            JournalMediaSerializer(media, context={"request": request}).data, status=201
        )


class JournalMediaDeleteView(APIView):
    """DELETE /api/v1/journal/<entry_id>/media/<pk>/ — owner only."""

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, entry_id, pk):
        media = get_object_or_404(
            _JournalMedia, pk=pk, entry_id=entry_id, entry__owner=request.user
        )
        # Delete the stored file too, not just the row. An orphaned object
        # in a bucket is a copy of someone's private photo that nobody is
        # tracking any more.
        media.file.delete(save=False)
        media.delete()
        return Response({"detail": "Attachment removed."})


class SharedEntriesView(APIView):
    """
    GET /api/v1/journal/shared/

    Journal entries other people have shared that the caller is entitled
    to see — community entries from anyone, connections entries from their
    connections. Reuses the same rules as `_get_visible_entry`, expressed
    once as a queryset.

    `identity='anonymous'` is honoured here: the author block is replaced
    with "Someone", and the real author id is not in the payload at all.
    Returning it and asking the client not to render it would make the
    setting a UI convention rather than a guarantee.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from django.db.models import Q

        from social.relations import blocked_user_ids, connected_user_ids
        from users.public import avatar_url, initials_for

        connections = connected_user_ids(request.user)
        blocked = blocked_user_ids(request.user)

        entries = (
            JournalEntry.objects.filter(is_deleted=False)
            .exclude(owner=request.user)
            .exclude(owner_id__in=blocked)
            .filter(Q(visibility="community") | Q(visibility="connections", owner_id__in=connections))
            .select_related("owner", "owner__profile")
            .prefetch_related("media")
            .order_by("-created_at")
        )

        limit = min(int(request.query_params.get("limit", 20)), 50)
        offset = max(int(request.query_params.get("offset", 0)), 0)
        total = entries.count()
        page = list(entries[offset:offset + limit])

        payload = []
        for entry in page:
            data = JournalEntrySerializer(entry, context={"request": request}).data
            if entry.identity == "anonymous":
                data["author"] = {"name": "Someone", "avatar": "?", "avatarUrl": None, "id": None}
            else:
                data["author"] = {
                    "id": entry.owner_id,
                    "name": entry.owner.fullname or entry.owner.username,
                    "username": entry.owner.username,
                    "avatar": initials_for(entry.owner),
                    "avatarUrl": avatar_url(entry.owner, request),
                }
            # The other two share settings, applied rather than returned:
            # a reader simply doesn't receive what the author excluded.
            if not entry.include_mood:
                data["mood"] = ""
            if not entry.include_date:
                data["created_at"] = None
            payload.append(data)

        return Response({
            "entries": payload,
            "total": total,
            "offset": offset,
            "limit": limit,
            "hasMore": offset + len(page) < total,
        })
