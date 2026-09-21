"""
Community discovery — the search bar at the top of the Community screen.

One endpoint searches across everything the caller is allowed to see:
people, Sanctuary posts, and library content. It reuses each subsystem's
own visibility queryset rather than writing its own filters, which is the
only way to be sure search can't surface something the feed would hide.
That is a real failure mode in social products — the search index outliving
a privacy change — and reusing the live queryset avoids it structurally.
"""

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import User
from users.public import PublicUserSerializer

from .models import SearchQuery, Topic, TopicFollow

RECENT_SEARCH_LIMIT = 8
TRENDING_MIN_DISTINCT_USERS = 3
TRENDING_WINDOW_DAYS = 14


class SearchView(APIView):
    """
    GET /api/v1/community/search/?q=&scope=all|people|posts|videos|articles

    Returns each section separately so the UI can label results by type,
    which is what its quick-filter chips (Videos / Articles / Posts /
    People) already expect.
    """

    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = "search"

    def get(self, request):
        query = (request.query_params.get("q") or "").strip()
        scope = request.query_params.get("scope", "all")

        if len(query) < 2:
            return Response({"people": [], "posts": [], "content": [], "total": 0})

        people = posts = content = []

        if scope in ("all", "people"):
            people = self._people(request, query)
        if scope in ("all", "posts"):
            posts = self._posts(request, query)
        if scope in ("all", "videos", "articles"):
            content = self._content(request, query, scope)

        total = len(people) + len(posts) + len(content)

        # Recorded after the search runs, with its real result count, so
        # the trending list reflects searches that found something.
        SearchQuery.objects.create(
            user=request.user, term=query[:120], scope=scope, result_count=total
        )

        return Response({"people": people, "posts": posts, "content": content, "total": total})

    @staticmethod
    def _people(request, query):
        from social.relations import blocked_user_ids

        users = (
            User.objects.filter(
                Q(username__icontains=query)
                | Q(fullname__icontains=query)
                | Q(profile__bio__icontains=query)
            )
            .exclude(id__in=blocked_user_ids(request.user) | {request.user.id})
            .exclude(profile__profile_visibility="private")
            .select_related("profile", "app_settings")
            .distinct()[:10]
        )
        return PublicUserSerializer(
            users, many=True, context={"request": request, "viewer": request.user}
        ).data

    @staticmethod
    def _posts(request, query):
        from sanctuary.serializers import serialize_post
        from sanctuary.views import _interaction_sets, visible_posts

        rows = list(
            visible_posts(request.user)
            .filter(Q(content__icontains=query) | Q(tags__icontains=query))[:10]
        )
        liked, bookmarked = _interaction_sets(request.user, rows)
        return [serialize_post(p, request.user, liked, bookmarked, request) for p in rows]

    @staticmethod
    def _content(request, query, scope):
        from content.models import Content, ContentReaction, ContentSave
        from content.views import library_queryset, serialize_content

        rows = library_queryset(request.user).filter(
            Q(title__icontains=query) | Q(description__icontains=query) | Q(tags__icontains=query)
        )
        if scope == "videos":
            rows = rows.filter(medium=Content.VIDEO)
        elif scope == "articles":
            rows = rows.filter(medium=Content.ARTICLE)

        rows = list(rows[:10])
        ids = [item.id for item in rows]
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
        return [serialize_content(item, request.user, liked, saved, request) for item in rows]


class SearchSuggestionsView(APIView):
    """
    GET /api/v1/community/search/suggestions/

    What the dropdown shows before anything is typed: this user's own
    recent searches, and genuinely trending terms.

    "Trending" here means: searched in the last two weeks by at least three
    different people, ordered by how many distinct people searched it. The
    distinct-user threshold is not a detail — counting raw searches would
    let one person's repeated query appear on everyone's screen, which is
    both wrong and a privacy leak.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        recent = list(
            SearchQuery.objects.filter(user=request.user)
            .values_list("term", flat=True)
            .distinct()[:RECENT_SEARCH_LIMIT]
        )

        cutoff = timezone.now() - timezone.timedelta(days=TRENDING_WINDOW_DAYS)
        trending = (
            SearchQuery.objects.filter(created_at__gte=cutoff, result_count__gt=0)
            .values("term")
            .annotate(people=Count("user", distinct=True))
            .filter(people__gte=TRENDING_MIN_DISTINCT_USERS)
            .order_by("-people")[:8]
        )

        return Response({
            "recent": recent,
            "trending": [row["term"] for row in trending],
        })

    def delete(self, request):
        """DELETE clears this user's own search history."""
        deleted, _ = SearchQuery.objects.filter(user=request.user).delete()
        return Response({"cleared": deleted})


class TopicListView(APIView):
    """GET /api/v1/community/topics/ — topics with real follower counts and
    whether the caller follows each."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        followed = set(
            TopicFollow.objects.filter(user=request.user).values_list("topic_id", flat=True)
        )
        topics = Topic.objects.annotate(follower_count=Count("followers"))
        return Response([
            {
                "id": topic.slug,
                "label": topic.label,
                "description": topic.description,
                "icon": topic.icon,
                "followers": topic.follower_count,
                "following": topic.id in followed,
            }
            for topic in topics
        ])


class TopicFollowView(APIView):
    """POST /api/v1/community/topics/<slug>/follow/ — toggles."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, slug):
        from rest_framework.generics import get_object_or_404

        topic = get_object_or_404(Topic, slug=slug)
        follow, created = TopicFollow.objects.get_or_create(topic=topic, user=request.user)
        if not created:
            follow.delete()
        return Response({"following": created, "followers": topic.followers.count()})
