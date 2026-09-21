"""
The Sanctuary feed API.

Who can see a post, stated once so it can be checked against the code:

  * A post is hidden if its author has blocked you, or you have blocked
    them — in either direction.
  * A `public` post is visible to any signed-in user.
  * A `connections` post is visible to the author and their accepted
    connections. Not to followers; following is not consent.
  * A post created from a journal entry disappears from the feed if that
    entry is later made private or deleted. This is the rule that makes
    "share to Sanctuary" safe to use: un-sharing the entry really does
    un-share it, rather than leaving a copy behind.
  * Your own posts are always visible to you.

All of that lives in `visible_posts()` below and every endpoint in this
module starts from it — including the single-post, comment and reaction
endpoints, so there is no path to a post through a side door.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count, Q
from rest_framework import permissions
from rest_framework.generics import get_object_or_404
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core.uploads import UploadKind, validate_upload
from social.relations import blocked_user_ids, connected_user_ids

from .models import PostBookmark, PostComment, PostMedia, PostReaction, PostShare, SanctuaryPost
from .serializers import serialize_comment, serialize_post

MAX_MEDIA_PER_POST = 4


def visible_posts(user):
    """The one queryset every Sanctuary endpoint starts from."""
    blocked = blocked_user_ids(user)
    connections = connected_user_ids(user)

    queryset = SanctuaryPost.objects.filter(is_deleted=False).exclude(author_id__in=blocked)

    visibility = (
        Q(author=user)
        | Q(visibility=SanctuaryPost.PUBLIC)
        | Q(visibility=SanctuaryPost.CONNECTIONS, author_id__in=connections)
    )

    # A post that came from a journal entry inherits that entry's fate: if
    # the entry was made private or soft-deleted, the post stops being
    # visible to anyone but its author.
    still_shared = Q(source_entry__isnull=True) | Q(
        source_entry__is_deleted=False, source_entry__visibility__in=["community", "connections"]
    )

    return (
        queryset.filter(visibility)
        .filter(still_shared | Q(author=user))
        .select_related("author", "author__profile", "source_entry")
        .prefetch_related("media")
        .annotate(
            like_count=Count("reactions", distinct=True),
            comment_count=Count("comments", distinct=True),
            share_count_real=Count("shares", distinct=True),
        )
    )


def _interaction_sets(user, posts):
    """Which of these posts the viewer has liked and bookmarked — two
    queries for the whole page rather than two per card."""
    ids = [post.id for post in posts]
    liked = set(
        PostReaction.objects.filter(user=user, post_id__in=ids).values_list("post_id", flat=True)
    )
    bookmarked = set(
        PostBookmark.objects.filter(user=user, post_id__in=ids).values_list("post_id", flat=True)
    )
    return liked, bookmarked


class FeedView(APIView):
    """
    GET  /api/v1/sanctuary/posts/?scope=all|connections|mine|bookmarked&tag=&q=
    POST /api/v1/sanctuary/posts/

    Paginated with `limit`/`offset` because a feed genuinely grows without
    bound — unlike the journal list, where pagination was deferred to avoid
    breaking a UI built for a plain array. This screen is new, so it gets
    the right shape from the start.
    """

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, *APIView.parser_classes]

    def get(self, request):
        queryset = visible_posts(request.user)

        scope = request.query_params.get("scope", "all")
        if scope == "connections":
            queryset = queryset.filter(author_id__in=connected_user_ids(request.user))
        elif scope == "mine":
            queryset = queryset.filter(author=request.user)
        elif scope == "bookmarked":
            saved = PostBookmark.objects.filter(user=request.user).values_list("post_id", flat=True)
            queryset = queryset.filter(id__in=saved)

        tag = (request.query_params.get("tag") or "").strip().lstrip("#")
        if tag:
            queryset = queryset.filter(tags__icontains=tag)

        query = (request.query_params.get("q") or "").strip()
        if query:
            queryset = queryset.filter(content__icontains=query)

        limit = min(int(request.query_params.get("limit", 20)), 50)
        offset = max(int(request.query_params.get("offset", 0)), 0)

        total = queryset.count()
        posts = list(queryset[offset:offset + limit])
        liked, bookmarked = _interaction_sets(request.user, posts)

        return Response({
            "posts": [
                serialize_post(post, request.user, liked, bookmarked, request) for post in posts
            ],
            "total": total,
            "offset": offset,
            "limit": limit,
            "hasMore": offset + len(posts) < total,
        })

    def post(self, request):
        content = (request.data.get("content") or "").strip()
        uploads = request.FILES.getlist("media")

        if not content and not uploads:
            return Response({"detail": "A post needs some words or an image."}, status=400)

        tags = request.data.get("tags")
        if isinstance(tags, str):
            # Multipart sends a comma-separated string; JSON sends a list.
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        tags = [t if t.startswith("#") else f"#{t}" for t in (tags or [])][:10]

        visibility = request.data.get("visibility", SanctuaryPost.PUBLIC)
        if visibility not in dict(SanctuaryPost.VISIBILITY_CHOICES):
            visibility = SanctuaryPost.PUBLIC

        validated = []
        for uploaded in uploads[:MAX_MEDIA_PER_POST]:
            try:
                kind, _ext, mime = validate_upload(
                    uploaded, allowed_kinds={UploadKind.IMAGE, UploadKind.VIDEO}
                )
            except DjangoValidationError as exc:
                return Response({"media": exc.messages}, status=400)
            validated.append((uploaded, kind, mime))

        post = SanctuaryPost.objects.create(
            author=request.user, content=content, tags=tags, visibility=visibility
        )
        for uploaded, kind, mime in validated:
            PostMedia.objects.create(
                post=post,
                file=uploaded,
                kind=kind,
                mime_type=mime,
                size_bytes=uploaded.size,
                alt_text=(request.data.get("alt") or "")[:300],
            )

        from achievements.models import Badge
        from achievements.services import award_quietly

        award_quietly(request.user, metrics={Badge.POSTS})

        post = visible_posts(request.user).get(pk=post.pk)
        return Response(
            serialize_post(post, request.user, set(), set(), request), status=201
        )


class PostDetailView(APIView):
    """GET/DELETE /api/v1/sanctuary/posts/<pk>/ — delete is author-only and
    soft, matching how journal entries behave."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        post = get_object_or_404(visible_posts(request.user), pk=pk)
        liked, bookmarked = _interaction_sets(request.user, [post])
        comments = _comments_payload(post, request)
        return Response(
            serialize_post(post, request.user, liked, bookmarked, request, comments)
        )

    def delete(self, request, pk):
        post = get_object_or_404(SanctuaryPost, pk=pk, author=request.user, is_deleted=False)
        post.is_deleted = True
        post.save(update_fields=["is_deleted"])
        return Response({"detail": "Post removed."})


def _comments_payload(post, request):
    comments = (
        PostComment.objects.filter(post=post, parent__isnull=True)
        .select_related("author", "author__profile")
        .prefetch_related("replies__author", "reactions")
    )
    liked_comment_ids = set(
        PostReaction.objects.filter(user=request.user, comment__post=post).values_list(
            "comment_id", flat=True
        )
    )
    return [serialize_comment(c, liked_comment_ids, request) for c in comments]


class CommentView(APIView):
    """GET/POST /api/v1/sanctuary/posts/<pk>/comments/"""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        post = get_object_or_404(visible_posts(request.user), pk=pk)
        return Response(_comments_payload(post, request))

    def post(self, request, pk):
        post = get_object_or_404(visible_posts(request.user), pk=pk)
        content = (request.data.get("content") or "").strip()
        if not content:
            return Response({"detail": "A comment needs some words."}, status=400)

        parent = None
        if request.data.get("parent"):
            # A reply's parent must belong to this post — otherwise a reply
            # could be smuggled onto a post the caller can't even see.
            parent = get_object_or_404(PostComment, pk=request.data["parent"], post=post)
            if parent.parent_id is not None:
                return Response({"detail": "Replies can't be nested further."}, status=400)

        comment = PostComment.objects.create(
            post=post, author=request.user, parent=parent, content=content
        )

        from notifications.services import notify

        display = request.user.fullname or request.user.username
        if parent is not None:
            notify(
                recipient=parent.author,
                actor=request.user,
                kind="reply",
                title="replied to your comment",
                body=content[:140],
                target=post,
                target_label=post.content[:60],
                dedupe_key=f"reply:{parent.id}:{request.user.id}",
            )
        notify(
            recipient=post.author,
            actor=request.user,
            kind="comment",
            title="commented on your post",
            body=content[:140],
            target=post,
            target_label=post.content[:60],
        )
        del display

        return Response(serialize_comment(comment, set(), request), status=201)


class CommentDetailView(APIView):
    """
    PATCH/DELETE /api/v1/sanctuary/posts/<pk>/comments/<comment_id>/

    Delete: the comment's author *or* the post's author — someone must be
    able to remove an unwanted comment from their own post, and there is
    no moderation queue to fall back on.

    Edit: the comment's author only. Removing someone's words from your
    post is reasonable; rewriting them under their name is not.
    """

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, pk, comment_id):
        from core.editing import apply_edit, check_editable, clean_text

        post = get_object_or_404(visible_posts(request.user), pk=pk)
        comment = get_object_or_404(PostComment, pk=comment_id, post=post)

        check_editable(comment, request.user)
        apply_edit(comment, clean_text(request.data.get("content"), max_length=2000))

        liked = set(
            PostReaction.objects.filter(user=request.user, comment=comment).values_list(
                "comment_id", flat=True
            )
        )
        return Response(serialize_comment(comment, liked, request))

    def delete(self, request, pk, comment_id):
        post = get_object_or_404(visible_posts(request.user), pk=pk)
        comment = get_object_or_404(PostComment, pk=comment_id, post=post)

        if comment.author_id != request.user.id and post.author_id != request.user.id:
            return Response({"detail": "You can't delete this comment."}, status=403)

        comment.delete()
        return Response({"detail": "Comment deleted."})


class ReactionView(APIView):
    """
    POST /api/v1/sanctuary/posts/<pk>/like/
    POST /api/v1/sanctuary/comments/<comment_id>/like/

    Both toggle. Liking your own post is allowed (people do) but never
    produces a notification — `notify()` drops self-notifications.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk=None, comment_id=None):
        if comment_id is not None:
            comment = get_object_or_404(PostComment, pk=comment_id)
            get_object_or_404(visible_posts(request.user), pk=comment.post_id)
            reaction, created = PostReaction.objects.get_or_create(
                user=request.user, comment=comment
            )
            if not created:
                reaction.delete()
            else:
                from notifications.services import notify

                notify(
                    recipient=comment.author,
                    actor=request.user,
                    kind="reaction",
                    title="liked your comment",
                    target=comment.post,
                    target_label=comment.content[:60],
                )
            return Response({"liked": created, "likes": comment.reactions.count()})

        post = get_object_or_404(visible_posts(request.user), pk=pk)
        reaction, created = PostReaction.objects.get_or_create(user=request.user, post=post)
        if not created:
            reaction.delete()
        else:
            from achievements.models import Badge
            from achievements.services import award_quietly
            from notifications.services import notify

            notify(
                recipient=post.author,
                actor=request.user,
                kind="like",
                title="liked your post",
                target=post,
                target_label=post.content[:60],
            )
            # The badge belongs to the person who received the reaction,
            # not the one who gave it.
            award_quietly(post.author, metrics={Badge.REACTIONS_RECEIVED})
        return Response({"liked": created, "likes": post.reactions.count()})


class BookmarkView(APIView):
    """POST /api/v1/sanctuary/posts/<pk>/bookmark/ — toggles, and never
    notifies the author: saving something is private."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        post = get_object_or_404(visible_posts(request.user), pk=pk)
        bookmark, created = PostBookmark.objects.get_or_create(user=request.user, post=post)
        if not created:
            bookmark.delete()
        return Response({"bookmarked": created})


class ShareView(APIView):
    """POST /api/v1/sanctuary/posts/<pk>/share/ — records a share."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        post = get_object_or_404(visible_posts(request.user), pk=pk)
        _share, created = PostShare.objects.get_or_create(user=request.user, post=post)

        if created:
            from notifications.services import notify

            notify(
                recipient=post.author,
                actor=request.user,
                kind="share",
                title="shared your post",
                target=post,
                target_label=post.content[:60],
            )

        return Response({"shared": True, "shares": post.shares.count()})


class ShareJournalEntryView(APIView):
    """
    POST /api/v1/sanctuary/share-entry/ — { entry_id }

    Turns a journal entry the user has already marked community-visible
    into a Sanctuary post. Refuses outright for a private entry: sharing
    must be a deliberate two-step act, and a single API call should not be
    able to publish something the user marked private.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        from journal.models import JournalEntry

        entry = get_object_or_404(
            JournalEntry, pk=request.data.get("entry_id"), owner=request.user, is_deleted=False
        )

        if entry.visibility == "private":
            return Response(
                {"detail": "Change this entry's visibility before sharing it."}, status=400
            )

        existing = SanctuaryPost.objects.filter(
            source_entry=entry, author=request.user, is_deleted=False
        ).first()
        if existing is not None:
            return Response({"detail": "This entry is already shared.", "id": existing.id}, status=200)

        visibility = (
            SanctuaryPost.PUBLIC if entry.visibility == "community" else SanctuaryPost.CONNECTIONS
        )
        post = SanctuaryPost.objects.create(
            author=request.user,
            content=entry.content,
            tags=[t if str(t).startswith("#") else f"#{t}" for t in (entry.tags or [])],
            visibility=visibility,
            source_entry=entry,
        )
        post = visible_posts(request.user).get(pk=post.pk)
        return Response(serialize_post(post, request.user, set(), set(), request), status=201)


class TrendingTagsView(APIView):
    """
    GET /api/v1/sanctuary/tags/

    Tags that actually appear on posts the caller can see, counted, most
    used first. Computed in Python because `tags` is a JSON list rather
    than a join table — at this scale that is the right trade, and the
    comment is here so the day it stops being the right trade is obvious.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from collections import Counter

        counter = Counter()
        for tags in visible_posts(request.user).values_list("tags", flat=True)[:1000]:
            for tag in tags or []:
                counter[str(tag).lower()] += 1

        limit = min(int(request.query_params.get("limit", 10)), 50)
        return Response([
            {"tag": tag, "count": count} for tag, count in counter.most_common(limit)
        ])
