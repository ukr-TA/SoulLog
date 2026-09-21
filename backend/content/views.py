"""
The content library API — the Videos tab inside Community.

Everything the UI shows is a real number: views are distinct `ContentView`
rows, likes and shares are counted rows, and `timeAgo` is derived from the
actual creation time. Nothing here is seeded with a plausible-looking
integer.

Uploading is open to any signed-in user rather than a separate creator
role. There is no approval queue in the product, so inventing a creator
permission would only be a lock with no key behind it; what does exist is
that an item is author-owned, and only its author can edit or remove it.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import permissions
from rest_framework.generics import get_object_or_404
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core.uploads import UploadKind, validate_upload
from social.relations import blocked_user_ids
from users.public import avatar_url, initials_for

from .models import (
    Content,
    ContentCategory,
    ContentComment,
    ContentReaction,
    ContentSave,
    ContentShare,
    ContentView,
)


def humanize_age(moment):
    seconds = (timezone.now() - moment).total_seconds()
    minutes = int(seconds // 60)
    if minutes < 60:
        return f"{max(minutes, 1)} minute{'s' if minutes != 1 else ''} ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    days = hours // 24
    if days < 30:
        return f"{days} day{'s' if days != 1 else ''} ago"
    return moment.strftime("%b %d, %Y")


def library_queryset(user):
    return (
        Content.objects.filter(status=Content.PUBLISHED)
        .exclude(author_id__in=blocked_user_ids(user))
        .select_related("author", "author__profile", "category")
        .annotate(
            like_count=Count("reactions", distinct=True),
            share_count=Count("shares", distinct=True),
            comment_count=Count("comments", distinct=True),
        )
    )


def serialize_content(item, viewer, liked_ids, saved_ids, request=None, progress=None):
    media_url = None
    if item.media_file:
        media_url = item.media_file.url
        if request is not None:
            media_url = request.build_absolute_uri(media_url)
    elif item.external_url:
        media_url = item.external_url

    thumbnail_url = None
    if item.thumbnail:
        thumbnail_url = item.thumbnail.url
        if request is not None:
            thumbnail_url = request.build_absolute_uri(thumbnail_url)

    return {
        "id": item.id,
        "title": item.title,
        "author": item.author.fullname or item.author.username,
        "authorId": item.author_id,
        "authorAvatar": initials_for(item.author),
        "authorAvatarUrl": avatar_url(item.author, request),
        # The UI draws an emoji when there is no real thumbnail; that
        # fallback is preserved rather than showing an empty frame.
        "thumbnail": thumbnail_url or item.thumbnail_emoji or "🎬",
        "thumbnailUrl": thumbnail_url,
        "mediaUrl": media_url,
        "medium": item.medium,
        "duration": item.duration_label,
        "durationSeconds": item.duration_seconds,
        "views": item.view_count,
        "likes": getattr(item, "like_count", 0),
        "shares": getattr(item, "share_count", 0),
        "commentCount": getattr(item, "comment_count", 0),
        "timeAgo": humanize_age(item.created_at),
        "createdAt": item.created_at.isoformat(),
        "description": item.description,
        "body": item.body,
        "category": item.category.slug if item.category else "",
        "categoryLabel": item.category.label if item.category else "",
        "tags": item.tags or [],
        "liked": item.id in liked_ids,
        "saved": item.id in saved_ids,
        "isOwn": item.author_id == viewer.id,
        "progressSeconds": progress or 0,
    }


class CategoryListView(APIView):
    """GET /api/v1/content/categories/ — including an item count per
    category, so a chip that would show nothing can be hidden."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        categories = ContentCategory.objects.annotate(
            item_count=Count("content", filter=Q(content__status=Content.PUBLISHED))
        )
        return Response(
            [
                {
                    "id": category.slug,
                    "label": category.label,
                    "icon": category.icon,
                    "count": category.item_count,
                }
                for category in categories
            ]
        )


class LibraryView(APIView):
    """
    GET  /api/v1/content/?category=&q=&scope=all|saved|mine|continue
    POST /api/v1/content/   (multipart upload, or an external_url)
    """

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, *APIView.parser_classes]

    def get(self, request):
        queryset = library_queryset(request.user)

        category = (request.query_params.get("category") or "all").strip()
        if category and category != "all":
            queryset = queryset.filter(category__slug=category)

        query = (request.query_params.get("q") or "").strip()
        if query:
            queryset = queryset.filter(
                Q(title__icontains=query)
                | Q(description__icontains=query)
                | Q(tags__icontains=query)
                | Q(author__fullname__icontains=query)
                | Q(author__username__icontains=query)
            )

        progress_map = {}
        scope = request.query_params.get("scope", "all")
        if scope == "saved":
            queryset = queryset.filter(
                id__in=ContentSave.objects.filter(user=request.user).values("content_id")
            )
        elif scope == "mine":
            queryset = queryset.filter(author=request.user)
        elif scope == "continue":
            rows = ContentView.objects.filter(
                user=request.user, completed=False, progress_seconds__gt=0
            ).order_by("-last_viewed_at")[:50]
            progress_map = {row.content_id: row.progress_seconds for row in rows}
            queryset = queryset.filter(id__in=progress_map.keys())

        limit = min(int(request.query_params.get("limit", 20)), 50)
        offset = max(int(request.query_params.get("offset", 0)), 0)

        total = queryset.count()
        items = list(queryset[offset:offset + limit])
        ids = [item.id for item in items]

        liked = set(
            ContentReaction.objects.filter(user=request.user, content_id__in=ids).values_list(
                "content_id", flat=True
            )
        )
        saved = set(
            ContentSave.objects.filter(user=request.user, content_id__in=ids).values_list(
                "content_id", flat=True
            )
        )

        return Response({
            "content": [
                serialize_content(
                    item, request.user, liked, saved, request, progress_map.get(item.id)
                )
                for item in items
            ],
            "total": total,
            "offset": offset,
            "limit": limit,
            "hasMore": offset + len(items) < total,
        })

    def post(self, request):
        title = (request.data.get("title") or "").strip()
        if not title:
            return Response({"title": ["A title is required."]}, status=400)

        medium = request.data.get("medium", Content.VIDEO)
        if medium not in dict(Content.MEDIUM_CHOICES):
            medium = Content.VIDEO

        external_url = (request.data.get("external_url") or "").strip()
        body = (request.data.get("body") or "").strip()
        upload = request.FILES.get("media_file")
        thumbnail = request.FILES.get("thumbnail")

        if not upload and not external_url and not body:
            return Response(
                {"detail": "Provide a file to upload, a link, or written content."}, status=400
            )

        if upload is not None:
            allowed = {UploadKind.VIDEO} if medium == Content.VIDEO else {UploadKind.AUDIO}
            try:
                validate_upload(upload, allowed_kinds=allowed)
            except DjangoValidationError as exc:
                return Response({"media_file": exc.messages}, status=400)

        if thumbnail is not None:
            try:
                validate_upload(thumbnail, allowed_kinds={UploadKind.IMAGE})
            except DjangoValidationError as exc:
                return Response({"thumbnail": exc.messages}, status=400)

        category = None
        if request.data.get("category"):
            category = ContentCategory.objects.filter(slug=request.data["category"]).first()

        tags = request.data.get("tags")
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]

        item = Content.objects.create(
            author=request.user,
            title=title[:200],
            description=(request.data.get("description") or "")[:5000],
            medium=medium,
            category=category,
            tags=(tags or [])[:10],
            media_file=upload,
            external_url=external_url,
            thumbnail=thumbnail,
            thumbnail_emoji=(request.data.get("thumbnail_emoji") or "")[:8],
            duration_seconds=int(request.data.get("duration_seconds") or 0),
            body=body,
        )
        item = library_queryset(request.user).get(pk=item.pk)
        return Response(serialize_content(item, request.user, set(), set(), request), status=201)


class ContentDetailView(APIView):
    """GET/DELETE /api/v1/content/<pk>/"""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        item = get_object_or_404(library_queryset(request.user), pk=pk)
        liked = set(
            ContentReaction.objects.filter(user=request.user, content=item).values_list(
                "content_id", flat=True
            )
        )
        saved = set(
            ContentSave.objects.filter(user=request.user, content=item).values_list(
                "content_id", flat=True
            )
        )
        view = ContentView.objects.filter(user=request.user, content=item).first()
        return Response(
            serialize_content(
                item, request.user, liked, saved, request, view.progress_seconds if view else 0
            )
        )

    def delete(self, request, pk):
        item = get_object_or_404(Content, pk=pk, author=request.user)
        item.delete()
        return Response({"detail": "Removed from the library."})


class ContentProgressView(APIView):
    """
    POST /api/v1/content/<pk>/progress/ — { seconds, completed }

    Also what increments the view count, and only on the first row created
    for that person: replaying something does not inflate its numbers.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        item = get_object_or_404(library_queryset(request.user), pk=pk)
        view, created = ContentView.objects.get_or_create(content=item, user=request.user)

        seconds = int(request.data.get("seconds") or 0)
        view.progress_seconds = max(view.progress_seconds, seconds)
        if request.data.get("completed"):
            view.completed = True
        view.save()

        if created:
            Content.objects.filter(pk=item.pk).update(view_count=item.views.count())

        return Response({
            "progressSeconds": view.progress_seconds,
            "completed": view.completed,
            "views": Content.objects.values_list("view_count", flat=True).get(pk=item.pk),
        })


class ContentReactionView(APIView):
    """POST /api/v1/content/<pk>/like/ — toggles."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        item = get_object_or_404(library_queryset(request.user), pk=pk)
        reaction, created = ContentReaction.objects.get_or_create(content=item, user=request.user)
        if not created:
            reaction.delete()
        else:
            from notifications.services import notify

            notify(
                recipient=item.author,
                actor=request.user,
                kind="like",
                title="liked your video",
                target=item,
                target_label=item.title,
            )
        return Response({"liked": created, "likes": item.reactions.count()})


class ContentSaveView(APIView):
    """POST /api/v1/content/<pk>/save/ — toggles. Private to the saver."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        item = get_object_or_404(library_queryset(request.user), pk=pk)
        save, created = ContentSave.objects.get_or_create(content=item, user=request.user)
        if not created:
            save.delete()
        return Response({"saved": created})


class ContentShareView(APIView):
    """POST /api/v1/content/<pk>/share/"""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        item = get_object_or_404(library_queryset(request.user), pk=pk)
        ContentShare.objects.get_or_create(content=item, user=request.user)
        return Response({"shared": True, "shares": item.shares.count()})


class ContentCommentView(APIView):
    """GET/POST /api/v1/content/<pk>/comments/"""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        item = get_object_or_404(library_queryset(request.user), pk=pk)
        comments = item.comments.select_related("author", "author__profile")[:100]
        return Response([self._serialize(c, request) for c in comments])

    def post(self, request, pk):
        item = get_object_or_404(library_queryset(request.user), pk=pk)
        body = (request.data.get("body") or request.data.get("content") or "").strip()
        if not body:
            return Response({"detail": "A comment needs some words."}, status=400)

        comment = ContentComment.objects.create(content=item, author=request.user, body=body)

        from notifications.services import notify

        notify(
            recipient=item.author,
            actor=request.user,
            kind="comment",
            title="commented on your video",
            body=body[:140],
            target=item,
            target_label=item.title,
        )
        return Response(self._serialize(comment, request), status=201)

    @staticmethod
    def _serialize(comment, request):
        return {
            "id": comment.id,
            "author": comment.author.fullname or comment.author.username,
            "authorId": comment.author_id,
            "avatar": initials_for(comment.author),
            "avatarUrl": avatar_url(comment.author, request),
            "content": comment.body,
            "timestamp": humanize_age(comment.created_at),
            "createdAt": comment.created_at.isoformat(),
            "editedAt": comment.edited_at.isoformat() if comment.edited_at else None,
            "isOwn": comment.author_id == getattr(request.user, "id", None) if request else False,
        }


class ContentCommentDetailView(APIView):
    """
    PATCH/DELETE /api/v1/content/<pk>/comments/<comment_id>/

    Delete: comment author or content author. Edit: comment author only.
    """

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, pk, comment_id):
        from core.editing import apply_edit, check_editable, clean_text

        item = get_object_or_404(library_queryset(request.user), pk=pk)
        comment = get_object_or_404(ContentComment, pk=comment_id, content=item)

        check_editable(comment, request.user)
        apply_edit(
            comment,
            clean_text(request.data.get("body") or request.data.get("content"), field="body", max_length=2000),
            text_attr="body",
        )
        return Response(ContentCommentView._serialize(comment, request))

    def delete(self, request, pk, comment_id):
        item = get_object_or_404(library_queryset(request.user), pk=pk)
        comment = get_object_or_404(ContentComment, pk=comment_id, content=item)
        if comment.author_id != request.user.id and item.author_id != request.user.id:
            return Response({"detail": "You can't delete this comment."}, status=403)
        comment.delete()
        return Response({"detail": "Comment deleted."})
