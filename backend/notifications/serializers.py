"""
Notification → the exact shape NotificationPage.tsx already renders.

The frontend's existing objects looked like:

    { id, type, user, userAvatar, action, target, content, time, isRead, category }

so that is what comes back, rather than a "cleaner" shape that would have
meant rewriting a working, polished screen. The same translation-at-the-
boundary approach already used for the auth token response and the Settings
privacy vocabulary.
"""

from django.utils import timezone

from .models import Notification, NotificationKind

SYSTEM_SENDERS = {
    NotificationKind.INSIGHT: ("SoulLog Insights", "📊"),
    NotificationKind.MILESTONE: ("SoulLog", "🎉"),
    NotificationKind.COMMUNITY: ("SoulLog Community", "🌟"),
    NotificationKind.REMINDER: ("SoulLog", "🕯️"),
}


def humanize_age(moment):
    seconds = (timezone.now() - moment).total_seconds()
    if seconds < 60:
        return "just now"
    minutes = int(seconds // 60)
    if minutes < 60:
        return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    days = hours // 24
    if days < 7:
        return f"{days} day{'s' if days != 1 else ''} ago"
    weeks = days // 7
    if weeks < 5:
        return f"{weeks} week{'s' if weeks != 1 else ''} ago"
    return moment.strftime("%b %d, %Y")


def _actor_fields(notification):
    system = SYSTEM_SENDERS.get(notification.kind)
    if notification.actor is None and system is not None:
        return system[0], system[1], None

    actor = notification.actor
    if actor is None:
        return "SoulLog", "🌙", None

    name = actor.fullname or actor.username
    return name, (name[0].upper() if name else "?"), actor.id


def _action_text(notification):
    """
    The sentence fragment shown after the name. `actor_count` is what turns
    a folded row into "and 12 others liked your post" — a real count of
    distinct people, not a decorative number.
    """
    base = notification.title
    if notification.actor_count > 1 and notification.actor is not None:
        others = notification.actor_count - 1
        return f"and {others} other{'s' if others != 1 else ''} {base[0].lower()}{base[1:]}"
    return base


def _badge_for(notification):
    """
    The badge behind an "You've earned …" notification, so the row can
    show the badge itself (its icon, name and what it was for) rather
    than a generic party popper.
    """
    key = notification.dedupe_key or ""
    if notification.kind != NotificationKind.MILESTONE or not key.startswith("badge:"):
        return None
    from achievements.models import Badge

    badge = Badge.objects.filter(slug=key.split(":", 1)[1]).first()
    if badge is None:
        return None
    return {"slug": badge.slug, "name": badge.name, "icon": badge.icon or "🏅", "description": badge.description}


def serialize_notification(notification, request=None):
    name, avatar, actor_id = _actor_fields(notification)
    badge = _badge_for(notification)
    if badge:
        avatar = badge["icon"]
    return {
        "badge": badge,
        "id": notification.id,
        "type": notification.kind,
        "user": name,
        "userAvatar": avatar,
        "actorId": actor_id,
        "action": _action_text(notification),
        # A badge row already names the badge in its title and chip.
        "target": "" if badge else notification.target_label,
        "content": notification.body,
        "time": humanize_age(notification.created_at),
        "createdAt": notification.created_at.isoformat(),
        "isRead": notification.is_read,
        "category": notification.category,
        "actorCount": notification.actor_count,
    }


def serialize_many(queryset, request=None):
    return [serialize_notification(item, request) for item in queryset]


def counts_for(user):
    """The badge counts behind NotificationPage's filter tabs."""
    rows = Notification.objects.filter(recipient=user)
    by_category = {}
    unread = 0
    total = 0

    # Tab numbers count only what's new (unread). A running total on every
    # tab just grows forever and stops meaning anything.
    for kind, is_read in rows.values_list("kind", "is_read"):
        if is_read:
            continue
        total += 1
        unread += 1
        category = NotificationKind.CATEGORY.get(kind, "engagement")
        by_category[category] = by_category.get(category, 0) + 1

    return {
        "all": total,
        "unread": unread,
        "engagement": by_category.get("engagement", 0),
        "social": by_category.get("social", 0),
        "community": by_category.get("community", 0),
        "insights": by_category.get("insights", 0),
        "achievements": by_category.get("achievements", 0),
    }
