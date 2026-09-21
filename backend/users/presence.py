"""
Deriving presence from `User.last_seen`.

Kept in its own module because three different subsystems need the same
answer to "is this person around?" — Whispers conversation headers, the
Connections list, and public profiles — and they must all respect the same
privacy rule.

The rule: a user's presence is only ever visible to someone else if that
user has `social.onlineStatus` enabled in their settings. When it's off,
everyone else sees `status='hidden'` and no timestamp at all — not a stale
one, not "a while ago". Their own view of themselves is unaffected.
"""

from django.conf import settings
from django.utils import timezone


def _online_status_enabled(user):
    app_settings = getattr(user, "app_settings", None)
    if app_settings is None:
        return True
    return bool((app_settings.social or {}).get("onlineStatus", True))


def presence_for(user, viewer=None):
    """
    Returns `{"status": ..., "last_seen": ...}` for `user` as `viewer` may
    see it.

    status is one of:
      "active"  — seen within PRESENCE_ACTIVE_WINDOW_SECONDS
      "away"    — seen before that
      "never"   — no recorded activity
      "hidden"  — this user does not share presence with others
    """
    is_self = viewer is not None and getattr(viewer, "id", None) == user.id

    if not is_self and not _online_status_enabled(user):
        return {"status": "hidden", "last_seen": None}

    if user.last_seen is None:
        return {"status": "never", "last_seen": None}

    window = settings.PRESENCE_ACTIVE_WINDOW_SECONDS
    seconds_ago = (timezone.now() - user.last_seen).total_seconds()
    return {
        "status": "active" if seconds_ago <= window else "away",
        "last_seen": user.last_seen,
    }


def humanize_presence(presence):
    """
    The short label Whispers shows under a name. Returns None when there is
    nothing honest to display, and the UI then shows nothing rather than
    inventing a status.
    """
    status = presence["status"]
    if status == "active":
        return "Active now"
    if status in ("hidden", "never"):
        return None

    seconds = (timezone.now() - presence["last_seen"]).total_seconds()
    minutes = int(seconds // 60)
    if minutes < 60:
        return f"Active {max(minutes, 1)}m ago"
    hours = minutes // 60
    if hours < 24:
        return f"Active {hours}h ago"
    days = hours // 24
    if days < 7:
        return f"Active {days}d ago"
    return "Active a while ago"
