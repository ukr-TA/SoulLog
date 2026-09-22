"""
The public view of a user — the one shape every social screen consumes.

Connections, Whispers, Community, Sanctuary and the profile pages all need
"who is this person, as far as I'm allowed to know". Defining that once, in
one serializer, means a field can't accidentally be exposed on one screen
and hidden on another.

Two rules are enforced here rather than left to each caller:

  * `show_email` / `show_phone` are respected. A contact detail the user has
    not chosen to publish is absent from the payload entirely — not blanked,
    not null-with-a-key that a client might render as an empty row.
  * `profile_visibility` decides how much of the profile body is returned.
    A `private` profile returns identity only (username, display name,
    avatar); a `connections` profile returns the full body only to accepted
    connections. This is applied at serialization, and separately the
    profile *view* refuses outright — defence in depth, since this
    serializer is also used inside feeds.
"""

from rest_framework import serializers

from .presence import humanize_presence, presence_for


def avatar_url(user, request=None):
    profile = getattr(user, "profile", None)
    image = getattr(profile, "profile_image", None)
    if not image:
        return None
    try:
        url = image.url
    except ValueError:
        return None
    return request.build_absolute_uri(url) if request is not None else url


def cover_url(user, request=None):
    profile = getattr(user, "profile", None)
    image = getattr(profile, "cover_image", None)
    if not image:
        return None
    try:
        url = image.url
    except ValueError:
        return None
    return request.build_absolute_uri(url) if request is not None else url


def initials_for(user):
    """
    The fallback the UI already draws when there's no uploaded image: a
    single letter in a coloured circle. Computed here so every screen shows
    the same letter for the same person.
    """
    source = (user.fullname or user.username or "").strip()
    return source[0].upper() if source else "?"


class PublicUserSerializer(serializers.Serializer):
    """
    Read-only. Never used for input, so it has no `create`/`update`.

    Pass `viewer` in the serializer context (the request user) to get the
    relationship-aware fields — `mutual_connections`, `relationship`,
    `is_following`. Without a viewer those fields are omitted rather than
    guessed.
    """

    def to_representation(self, user):
        request = self.context.get("request")
        viewer = self.context.get("viewer") or getattr(request, "user", None)
        profile = getattr(user, "profile", None)

        presence = presence_for(user, viewer)

        data = {
            "id": user.id,
            "username": user.username,
            "name": user.fullname or user.username,
            "initials": initials_for(user),
            "avatar_url": avatar_url(user, request),
            "presence": presence["status"],
            "presence_label": humanize_presence(presence),
            "joined": user.created_at,
        }

        if profile is None:
            return data

        can_see_body = self._can_see_profile_body(user, viewer, profile)
        data["profile_visibility"] = profile.profile_visibility
        data["visible"] = can_see_body

        if can_see_body:
            data.update({
                "bio": profile.bio,
                "tagline": profile.tagline,
                "location": profile.location,
                "website": profile.website,
                "current_focus": profile.current_focus,
                "growth_areas": profile.growth_areas,
                "values": profile.values,
                "interests": profile.favorite_topics or [],
                "mentor_available": profile.mentor_available,
                "cover_url": cover_url(user, request),
            })
            if profile.show_email:
                data["email"] = user.email
            if profile.show_phone:
                data["phone"] = user.phone_number

        if viewer is not None and getattr(viewer, "is_authenticated", False) and viewer.id != user.id:
            from social.relations import connection_between, following_ids, mutual_connection_count

            connection = connection_between(viewer, user)
            data["mutual_connections"] = mutual_connection_count(viewer, user)
            data["relationship"] = self._relationship_shape(connection, viewer)
            data["is_following"] = user.id in following_ids(viewer)
        elif viewer is not None and getattr(viewer, "id", None) == user.id:
            data["relationship"] = {"state": "self", "direction": None, "connection_id": None}

        return data

    @staticmethod
    def _can_see_profile_body(user, viewer, profile):
        if viewer is None or not getattr(viewer, "is_authenticated", False):
            return profile.profile_visibility == "public"
        if viewer.id == user.id:
            return True
        if profile.profile_visibility == "public":
            return True
        if profile.profile_visibility == "private":
            return False

        from social.relations import are_connected

        return are_connected(viewer, user)

    @staticmethod
    def _relationship_shape(connection, viewer):
        """
        What the viewer's button should say. `direction` matters because a
        pending request needs "Accept/Decline" for the addressee but
        "Requested" for the requester.
        """
        if connection is None:
            return {"state": "none", "direction": None, "connection_id": None}

        direction = "outgoing" if connection.requester_id == viewer.id else "incoming"
        state = connection.status

        if state == "blocked":
            # Only the person who blocked sees it as a block; to the blocked
            # user the relationship simply reads as absent.
            if connection.blocked_by_id == viewer.id:
                return {"state": "blocked", "direction": "outgoing", "connection_id": connection.id}
            return {"state": "none", "direction": None, "connection_id": None}

        return {"state": state, "direction": direction, "connection_id": connection.id}
