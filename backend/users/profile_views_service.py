"""
Recording and reading profile views.

Kept apart from the profile endpoints so that the reciprocity rule lives
in one readable place rather than being a condition buried in a view
function. Everything that writes a ProfileView goes through
`record_view()`; nothing else should create one.
"""

import logging

from django.db import IntegrityError
from django.utils import timezone

from .models import ProfileView

logger = logging.getLogger("soullog.users")


def _shares_views(user):
    profile = getattr(user, "profile", None)
    return bool(profile and profile.show_profile_views)


def record_view(viewer, profile_owner):
    """
    Record that `viewer` looked at `profile_owner`'s profile — if, and
    only if, both of them share profile views.

    Returns True when a row was written or refreshed, False when the
    visit was deliberately not recorded. Never raises: a failure to log a
    page view must not break the page.

    The four reasons nothing is recorded:
      * you're looking at your own profile
      * the viewer doesn't share their views (so they aren't observed)
      * the owner doesn't share theirs (so they don't observe)
      * either account is blocked by the other
    """
    try:
        if viewer is None or not getattr(viewer, "is_authenticated", False):
            return False
        if viewer.id == profile_owner.id:
            return False
        if not _shares_views(viewer) or not _shares_views(profile_owner):
            return False

        from social.relations import is_blocked_between

        if is_blocked_between(viewer, profile_owner):
            return False

        today = timezone.localdate()
        existing = ProfileView.objects.filter(
            viewer=viewer, profile_owner=profile_owner, viewed_on=today
        ).first()

        if existing is not None:
            # Same person, same day: one view, but move them to the top
            # of the list. auto_now on last_seen_at does the work.
            existing.save(update_fields=["last_seen_at"])
            return True

        try:
            ProfileView.objects.create(
                viewer=viewer, profile_owner=profile_owner, viewed_on=today
            )
        except IntegrityError:
            # Two tabs at once. The constraint did its job; nothing to do.
            return True
        return True
    except Exception:  # noqa: BLE001 — see docstring
        logger.warning("Profile view not recorded", exc_info=True)
        return False


def _recent_queryset(user):
    cutoff = timezone.now() - timezone.timedelta(days=ProfileView.RETENTION_DAYS)
    return ProfileView.objects.filter(
        profile_owner=user, last_seen_at__gte=cutoff
    ).exclude(viewer=user)


def view_count(user):
    """
    How many distinct people viewed this profile in the retention window.

    Returns 0 — not a stale historical number — when the user has the
    setting off, because with it off nothing is being recorded and any
    number would be describing a period that has ended.
    """
    if not _shares_views(user):
        return 0
    return _recent_queryset(user).count()


def viewers_for(user, request=None, limit=50):
    """The people behind that number, most recent first."""
    if not _shares_views(user):
        return []

    from social.relations import blocked_user_ids

    from .public import PublicUserSerializer

    blocked = blocked_user_ids(user)
    rows = list(
        _recent_queryset(user)
        .exclude(viewer_id__in=blocked)
        .select_related("viewer", "viewer__profile", "viewer__app_settings")[:limit]
    )

    serialized = PublicUserSerializer(
        [row.viewer for row in rows], many=True,
        context={"request": request, "viewer": user},
    ).data

    when = {row.viewer_id: row.last_seen_at for row in rows}
    for item in serialized:
        stamp = when.get(item["id"])
        item["viewedAt"] = stamp.isoformat() if stamp else None
    return serialized


def prune(days=None):
    """Delete views past the retention window. Returns how many went."""
    days = days or ProfileView.RETENTION_DAYS
    cutoff = timezone.now() - timezone.timedelta(days=days)
    deleted, _ = ProfileView.objects.filter(last_seen_at__lt=cutoff).delete()
    return deleted
