"""
The Connections API.

`ConnectionPage.tsx` has always had three tabs — Requests, Suggestions,
Friends — plus a search box and four filters (location, mutual friends,
interests, activity). Every one of those was filtering a hardcoded array.
Each now maps to a real query below, and the filters do real work rather
than being accepted and ignored.

Suggestion ranking is described in full in `suggestions()` because an
opaque "recommended" label is exactly the kind of thing that erodes trust
in a wellness product: the UI shows the reason, and the reason is true.
"""

from django.db.models import Q
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import User
from users.public import PublicUserSerializer

from .models import Connection, Follow
from .relations import (
    blocked_user_ids,
    connected_user_ids,
    connection_between,
    mutual_connection_count,
)


def _serialize(users, request, extra=None):
    data = PublicUserSerializer(
        users, many=True, context={"request": request, "viewer": request.user}
    ).data
    if extra:
        for item in data:
            item.update(extra.get(item["id"], {}))
    return data


class ConnectionListView(APIView):
    """
    GET /api/v1/social/connections/ — the caller's accepted connections.

    Ordered by most recently active so the Friends tab is useful rather
    than alphabetical-by-accident.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        ids = connected_user_ids(request.user)
        users = (
            User.objects.filter(id__in=ids)
            .select_related("profile", "app_settings")
            .order_by("-last_seen", "username")
        )
        return Response(_serialize(users, request))


class ConnectionRequestListView(APIView):
    """
    GET /api/v1/social/requests/?direction=incoming|outgoing

    Incoming is the Requests tab. Outgoing exists so the UI can show a
    "Requested" state instead of offering to send the same request twice.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        direction = request.query_params.get("direction", "incoming")

        if direction == "outgoing":
            rows = Connection.objects.filter(requester=request.user, status=Connection.PENDING)
            people = {row.addressee_id: row for row in rows.select_related("addressee")}
            users = User.objects.filter(id__in=people).select_related("profile", "app_settings")
        else:
            rows = Connection.objects.filter(addressee=request.user, status=Connection.PENDING)
            people = {row.requester_id: row for row in rows.select_related("requester")}
            users = User.objects.filter(id__in=people).select_related("profile", "app_settings")

        extra = {
            uid: {
                "connection_id": row.id,
                "requested_at": row.created_at,
                "mutual_connections": mutual_connection_count(request.user, row.other_user(request.user)),
            }
            for uid, row in people.items()
        }
        return Response(_serialize(users, request, extra))


class ConnectionRequestCreateView(APIView):
    """
    POST /api/v1/social/requests/  { "username": ... } or { "user_id": ... }

    Sending a request to someone who has already requested you accepts
    theirs instead of creating a second, competing row — the natural thing
    to want, and the thing the one-row-per-pair model makes easy.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        target = _resolve_target(request)

        if target.id == request.user.id:
            return Response({"detail": "You can't connect with yourself."}, status=400)

        existing = connection_between(request.user, target)

        if existing is not None:
            if existing.status == Connection.BLOCKED:
                return Response({"detail": "This person isn't accepting connection requests."}, status=403)
            if existing.status == Connection.ACCEPTED:
                return Response({"detail": "You're already connected."}, status=400)
            if existing.status == Connection.PENDING:
                if existing.addressee_id == request.user.id:
                    return _accept(existing, request)
                return Response({"detail": "Your request is already pending."}, status=400)
            if existing.status == Connection.DECLINED:
                # A declined request can be re-sent, but only by re-using the
                # same row — so the other person still sees one request, not
                # a growing pile.
                if existing.requester_id != request.user.id:
                    existing.requester, existing.addressee = request.user, existing.requester
                existing.status = Connection.PENDING
                existing.responded_at = None
                existing.created_at = timezone.now()
                existing.save()
                _notify_request(existing)
                return Response(_connection_payload(existing, request), status=201)

        connection = Connection.objects.create(requester=request.user, addressee=target)
        _notify_request(connection)
        return Response(_connection_payload(connection, request), status=201)


class ConnectionRespondView(APIView):
    """
    POST /api/v1/social/requests/<pk>/respond/  { "action": "accept" | "decline" }

    Only the addressee may respond — a requester cannot accept their own
    request, which is enforced by the queryset, not by a client-side check.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        connection = get_object_or_404(
            Connection, pk=pk, addressee=request.user, status=Connection.PENDING
        )
        action = request.data.get("action")

        if action == "accept":
            return _accept(connection, request)
        if action == "decline":
            connection.status = Connection.DECLINED
            connection.responded_at = timezone.now()
            connection.save(update_fields=["status", "responded_at", "updated_at"])
            return Response(_connection_payload(connection, request))

        return Response({"detail": "action must be 'accept' or 'decline'."}, status=400)


class ConnectionDeleteView(APIView):
    """
    DELETE /api/v1/social/connections/<user_id>/ — remove a connection, or
    withdraw a request you sent.

    The row is deleted rather than marked, because unlike a decline there's
    nothing to remember: either party may freely connect again later.
    """

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, user_id):
        target = get_object_or_404(User, pk=user_id)
        connection = connection_between(request.user, target)

        if connection is None or connection.status == Connection.BLOCKED:
            return Response({"detail": "No connection to remove."}, status=404)

        connection.delete()
        return Response({"detail": "Connection removed."}, status=200)


class BlockView(APIView):
    """
    POST   /api/v1/social/block/<user_id>/  — block
    DELETE /api/v1/social/block/<user_id>/  — unblock (blocker only)

    Blocking supersedes any existing connection or request, and also drops
    any follow in either direction: leaving a follow in place would keep
    the blocked person's activity flowing into a feed, which is precisely
    what blocking is meant to stop.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, user_id):
        target = get_object_or_404(User, pk=user_id)
        if target.id == request.user.id:
            return Response({"detail": "You can't block yourself."}, status=400)

        connection = connection_between(request.user, target)
        if connection is None:
            connection = Connection(requester=request.user, addressee=target)

        connection.status = Connection.BLOCKED
        connection.blocked_by = request.user
        connection.responded_at = timezone.now()
        connection.save()

        Follow.objects.filter(
            Q(follower=request.user, following=target) | Q(follower=target, following=request.user)
        ).delete()

        return Response({"detail": "Blocked."})

    def delete(self, request, user_id):
        target = get_object_or_404(User, pk=user_id)
        connection = Connection.objects.filter(status=Connection.BLOCKED).between(
            request.user, target
        ).first()

        if connection is None:
            return Response({"detail": "This person isn't blocked."}, status=404)
        if connection.blocked_by_id != request.user.id:
            # The blocked party must not be able to lift someone else's block.
            return Response({"detail": "You can't unblock this person."}, status=403)

        connection.delete()
        return Response({"detail": "Unblocked."})


class BlockedListView(APIView):
    """GET /api/v1/social/blocked/ — everyone the caller has blocked, for
    the Settings screen's blocked-accounts list."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        rows = Connection.objects.filter(status=Connection.BLOCKED, blocked_by=request.user)
        ids = [row.other_user(request.user).id for row in rows]
        users = User.objects.filter(id__in=ids).select_related("profile", "app_settings")
        return Response(_serialize(users, request))


class FollowView(APIView):
    """POST/DELETE /api/v1/social/follow/<user_id>/ — one-way follow."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, user_id):
        target = get_object_or_404(User, pk=user_id)
        if target.id == request.user.id:
            return Response({"detail": "You can't follow yourself."}, status=400)
        if user_id in blocked_user_ids(request.user):
            return Response({"detail": "You can't follow this person."}, status=403)

        Follow.objects.get_or_create(follower=request.user, following=target)
        _notify_follow(request.user, target)
        return Response({"following": True})

    def delete(self, request, user_id):
        Follow.objects.filter(follower=request.user, following_id=user_id).delete()
        return Response({"following": False})


class SuggestionsView(APIView):
    """
    GET /api/v1/social/suggestions/

    Ranking, in order of weight, all computed from real data:

      1. Mutual connections      (3 points each, capped at 15)
      2. Shared interests        (4 points each) — `profile.favorite_topics`
      3. Same location           (5 points) — exact, case-insensitive match
      4. Recently active         (2 points) — seen in the last 7 days
      5. Offers mentoring        (2 points) — `profile.mentor_available`

    `reason` is whichever single factor contributed most, phrased the way
    the UI already phrases it. If nothing contributed, the person simply
    isn't suggested — SoulLog does not pad the list to fill a grid.

    Excluded, always: yourself, anyone you're already connected to, anyone
    with a pending or declined request either way, anyone blocked either
    way, and anyone whose profile visibility is `private`.
    """

    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = "search"

    def get(self, request):
        user = request.user
        limit = min(int(request.query_params.get("limit", 24)), 100)

        excluded = {user.id}
        excluded |= set(
            Connection.objects.involving(user).values_list("requester_id", flat=True)
        )
        excluded |= set(
            Connection.objects.involving(user).values_list("addressee_id", flat=True)
        )

        candidates = (
            User.objects.exclude(id__in=excluded)
            .exclude(is_active=False)
            .exclude(profile__profile_visibility="private")
            .select_related("profile", "app_settings")
        )

        # Filters, applied before ranking so they are hard constraints.
        location = (request.query_params.get("location") or "").strip()
        interest = (request.query_params.get("interests") or "").strip()
        activity = (request.query_params.get("activity") or "").strip()
        query = (request.query_params.get("q") or "").strip()

        if location:
            candidates = candidates.filter(profile__location__icontains=location)
        if interest:
            candidates = candidates.filter(profile__favorite_topics__icontains=interest)
        if query:
            candidates = candidates.filter(
                Q(username__icontains=query)
                | Q(fullname__icontains=query)
                | Q(profile__bio__icontains=query)
            )
        if activity == "active":
            cutoff = timezone.now() - timezone.timedelta(days=7)
            candidates = candidates.filter(last_seen__gte=cutoff)
        elif activity == "new":
            cutoff = timezone.now() - timezone.timedelta(days=30)
            candidates = candidates.filter(created_at__gte=cutoff)

        my_connections = connected_user_ids(user)
        my_profile = getattr(user, "profile", None)
        my_interests = {i.lower() for i in (my_profile.favorite_topics or [])} if my_profile else set()
        my_location = (my_profile.location or "").strip().lower() if my_profile else ""
        recent_cutoff = timezone.now() - timezone.timedelta(days=7)

        minimum_mutual = request.query_params.get("mutualFriends")
        minimum_mutual = int(minimum_mutual) if (minimum_mutual or "").isdigit() else 0

        scored = []
        for candidate in candidates[:500]:  # bounded: ranking is done in Python
            profile = getattr(candidate, "profile", None)
            mutual = len(my_connections & connected_user_ids(candidate))
            if mutual < minimum_mutual:
                continue

            factors = []
            score = 0

            if mutual:
                points = min(mutual * 3, 15)
                score += points
                factors.append((points, f"{mutual} mutual connection{'s' if mutual != 1 else ''}"))

            if profile is not None:
                shared = my_interests & {i.lower() for i in (profile.favorite_topics or [])}
                if shared:
                    points = 4 * len(shared)
                    score += points
                    factors.append((points, "Similar interests"))

                if my_location and (profile.location or "").strip().lower() == my_location:
                    score += 5
                    factors.append((5, "Same city"))

                if profile.mentor_available:
                    score += 2
                    factors.append((2, "Available to mentor"))

            if candidate.last_seen and candidate.last_seen >= recent_cutoff:
                score += 2
                factors.append((2, "Recently active"))

            if score == 0:
                continue

            factors.sort(reverse=True)
            scored.append((score, candidate, factors[0][1], mutual))

        scored.sort(key=lambda row: (-row[0], row[1].username))
        top = scored[:limit]

        extra = {
            candidate.id: {"reason": reason, "mutual_connections": mutual, "match_score": score}
            for score, candidate, reason, mutual in top
        }
        return Response(_serialize([row[1] for row in top], request, extra))


class UserSearchView(APIView):
    """
    GET /api/v1/social/search/?q=

    Backs the people search in both ConnectionPage and CommunitySearch.
    Private profiles and blocked users never appear. An empty query returns
    an empty list rather than the entire user table.
    """

    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = "search"

    def get(self, request):
        query = (request.query_params.get("q") or "").strip()
        if len(query) < 2:
            return Response([])

        limit = min(int(request.query_params.get("limit", 20)), 50)
        excluded = blocked_user_ids(request.user) | {request.user.id}

        users = (
            User.objects.filter(
                Q(username__icontains=query)
                | Q(fullname__icontains=query)
                | Q(profile__bio__icontains=query)
            )
            .exclude(id__in=excluded)
            .exclude(profile__profile_visibility="private")
            .exclude(is_active=False)
            .select_related("profile", "app_settings")
            .distinct()[:limit]
        )
        return Response(_serialize(users, request))


# --- helpers ----------------------------------------------------------------

def _resolve_target(request):
    if request.data.get("user_id"):
        return get_object_or_404(User, pk=request.data["user_id"])
    username = request.data.get("username")
    if not username:
        from rest_framework.exceptions import ValidationError

        raise ValidationError({"detail": "Provide user_id or username."})
    return get_object_or_404(User, username__iexact=username)


def _accept(connection, request):
    connection.status = Connection.ACCEPTED
    connection.responded_at = timezone.now()
    connection.save(update_fields=["status", "responded_at", "updated_at"])
    _notify_accepted(connection)

    # A new connection changes the count for both of them, so both are
    # checked — not just whoever pressed accept.
    from achievements.models import Badge
    from achievements.services import award_quietly

    award_quietly(connection.requester, metrics={Badge.CONNECTIONS})
    award_quietly(connection.addressee, metrics={Badge.CONNECTIONS})

    return Response(_connection_payload(connection, request), status=status.HTTP_200_OK)


def _connection_payload(connection, request):
    other = connection.other_user(request.user)
    return {
        "connection_id": connection.id,
        "status": connection.status,
        "user": PublicUserSerializer(
            other, context={"request": request, "viewer": request.user}
        ).data,
    }


def _notify_request(connection):
    from notifications.services import notify

    notify(
        recipient=connection.addressee,
        actor=connection.requester,
        kind="connection_request",
        title="New connection request",
        body=f"{connection.requester.fullname or connection.requester.username} wants to connect with you.",
        target=connection,
    )


def _notify_accepted(connection):
    from notifications.services import notify

    notify(
        recipient=connection.requester,
        actor=connection.addressee,
        kind="connection_accepted",
        title="Connection accepted",
        body=f"{connection.addressee.fullname or connection.addressee.username} accepted your connection request.",
        target=connection,
    )


def _notify_follow(follower, target):
    from notifications.services import notify

    notify(
        recipient=target,
        actor=follower,
        kind="follow",
        title="New follower",
        body=f"{follower.fullname or follower.username} started following you.",
    )
