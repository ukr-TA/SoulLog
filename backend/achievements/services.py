"""
Measuring what a user has done, and awarding badges for it.

Two rules shape this module:

  A badge is never awarded for something that isn't true. Every metric
  below is a live count or calculation over the user's own rows — there
  is no "progress" column that could drift away from reality.

  Awarding is idempotent. `check_and_award()` can be called after any
  action, as often as you like; it only ever creates rows for conditions
  newly met. That means call sites don't need to know which badges their
  action might have unlocked, which is what keeps this from becoming a
  web of special cases.
"""

import logging

from django.db.models import Q
from django.utils import timezone

from .models import Badge, UserBadge

logger = logging.getLogger("soullog.achievements")


# --- the metrics a badge may be defined against -----------------------------

def _active_dates(user):
    """Every calendar day the user journalled or checked in."""
    from journal.models import JournalEntry
    from moods.models import MoodCheckIn

    journal_dates = set(
        JournalEntry.objects.filter(owner=user, is_deleted=False)
        .values_list("created_at__date", flat=True)
    )
    mood_dates = set(
        MoodCheckIn.objects.filter(owner=user).values_list("created_at__date", flat=True)
    )
    return journal_dates | mood_dates


def current_streak(user):
    """
    Consecutive active days ending today.

    Same rule as the dashboard: today doesn't have to be active yet — a
    streak stays alive until a full day passes with nothing logged.
    """
    from datetime import timedelta

    active = _active_dates(user)
    if not active:
        return 0

    streak = 0
    cursor = timezone.now().date()
    while cursor in active:
        streak += 1
        cursor -= timedelta(days=1)

    if streak == 0:
        cursor = timezone.now().date() - timedelta(days=1)
        while cursor in active:
            streak += 1
            cursor -= timedelta(days=1)

    return streak


def best_streak(user):
    """
    The longest run of consecutive active days, ever.

    Worth having for its own sake, not only for badges. A current-streak
    number alone means someone who journalled faithfully for two months
    and then had a hard week sees a "1" and nothing else. The longest
    streak is a record of what they did, and it can't be taken away by a
    bad fortnight — which matters in an app about wellbeing.
    """
    from datetime import timedelta

    active = sorted(_active_dates(user))
    if not active:
        return 0

    longest = run = 1
    for previous, day in zip(active, active[1:]):
        run = run + 1 if day - previous == timedelta(days=1) else 1
        longest = max(longest, run)
    return longest


def entry_count(user):
    from journal.models import JournalEntry

    return JournalEntry.objects.filter(owner=user, is_deleted=False).count()


def mood_checkin_count(user):
    from moods.models import MoodCheckIn

    return MoodCheckIn.objects.filter(owner=user).count()


def connection_count(user):
    from social.relations import connected_user_ids

    return len(connected_user_ids(user))


def post_count(user):
    from sanctuary.models import SanctuaryPost

    return SanctuaryPost.objects.filter(author=user, is_deleted=False).count()


def reactions_received(user):
    """
    How many times other people reacted to something this user made.

    Counts hearts on their Sanctuary posts, on their comments (both on
    posts and on journal entries), and on anything they've added to the
    library. Their own reactions to their own content are excluded —
    otherwise the number is partly self-applause.

    This is the figure the profile used to print as "Total Reactions"
    without anything behind it. Every reaction it counts is a row.
    """
    from content.models import ContentReaction
    from journal.models import JournalCommentReaction
    from sanctuary.models import PostReaction

    on_posts = PostReaction.objects.filter(
        Q(post__author=user) | Q(comment__author=user)
    ).exclude(user=user).count()

    on_journal_comments = JournalCommentReaction.objects.filter(
        comment__author=user
    ).exclude(user=user).count()

    on_content = ContentReaction.objects.filter(content__author=user).exclude(
        user=user
    ).count()

    return on_posts + on_journal_comments + on_content


METRICS = {
    Badge.CURRENT_STREAK: current_streak,
    Badge.BEST_STREAK: best_streak,
    Badge.ENTRIES: entry_count,
    Badge.MOOD_CHECKINS: mood_checkin_count,
    Badge.CONNECTIONS: connection_count,
    Badge.POSTS: post_count,
    Badge.REACTIONS_RECEIVED: reactions_received,
}


# --- awarding ---------------------------------------------------------------

def check_and_award(user, metrics=None):
    """
    Award any badge whose condition is now met and wasn't before.

    `metrics` narrows the work to the metrics an action could plausibly
    have changed — writing a journal entry can't affect your connection
    count, so there's no reason to compute it. Omit it to check
    everything.

    Returns the list of newly-created UserBadge rows. Safe to call
    repeatedly; safe to call when nothing has changed.
    """
    candidates = Badge.objects.filter(is_active=True)
    if metrics:
        candidates = candidates.filter(metric__in=metrics)

    already_earned = set(
        UserBadge.objects.filter(user=user).values_list("badge_id", flat=True)
    )
    pending = [badge for badge in candidates if badge.id not in already_earned]
    if not pending:
        return []

    # One computation per distinct metric, not one per badge — three
    # streak badges shouldn't mean three passes over the same dates.
    values = {}
    for badge in pending:
        if badge.metric not in values:
            values[badge.metric] = METRICS[badge.metric](user)

    awarded = []
    for badge in pending:
        value = values[badge.metric]
        if value < badge.threshold:
            continue

        row, created = UserBadge.objects.get_or_create(
            user=user, badge=badge, defaults={"value_at_award": value}
        )
        if created:
            awarded.append(row)
            _notify(user, badge, value)

    return awarded


def _notify(user, badge, value):
    """Tell the user, once, at the moment they earn it."""
    from notifications.services import notify

    notify(
        recipient=user,
        actor=None,
        kind="milestone",
        title=f"You've earned {badge.name}",
        body=badge.description,
        target_label=badge.name,
        dedupe_key=f"badge:{badge.slug}",
    )
    del value


def award_quietly(user, metrics=None):
    """
    `check_and_award` for call sites where a failure must not break the
    user's action.

    Earning a badge is a nice moment; it is never worth failing someone's
    journal entry over. Any error here is logged and swallowed.
    """
    try:
        return check_and_award(user, metrics=metrics)
    except Exception:  # noqa: BLE001 — deliberate, see docstring
        logger.warning("Badge check failed", exc_info=True)
        return []


def summary_for(user, viewer=None):
    """
    A user's earned badges, newest first.

    Shown on their own profile and on other people's — badges are a
    public thing, which is rather the point of them. `viewer` is accepted
    for symmetry with the other serializers and because a future "hide my
    badges" setting would be enforced here.
    """
    rows = (
        UserBadge.objects.filter(user=user)
        .select_related("badge")
        .order_by("-earned_at")
    )
    del viewer

    return [
        {
            "slug": row.badge.slug,
            "name": row.badge.name,
            "icon": row.badge.icon or "🏅",
            "description": row.badge.description,
            "earned": row.earned_at.strftime("%B %Y"),
            "earnedAt": row.earned_at.isoformat(),
            "value": row.value_at_award,
        }
        for row in rows
    ]


def progress_for(user):
    """
    The next unearned badge for each metric, with how far along the user
    is.

    Deliberately shows only the *next* one rather than the whole ladder:
    a list of everything not yet achieved is a list of ways you're
    falling short, which is not what this app is for.
    """
    earned = set(UserBadge.objects.filter(user=user).values_list("badge_id", flat=True))
    upcoming = {}

    for badge in Badge.objects.filter(is_active=True):
        if badge.id in earned:
            continue
        current = upcoming.get(badge.metric)
        if current is None or badge.threshold < current.threshold:
            upcoming[badge.metric] = badge

    rows = []
    for metric, badge in upcoming.items():
        value = METRICS[metric](user)
        rows.append({
            "slug": badge.slug,
            "name": badge.name,
            "icon": badge.icon or "🏅",
            "description": badge.description,
            "current": value,
            "threshold": badge.threshold,
            "percent": min(round(value / badge.threshold * 100), 99),
        })

    rows.sort(key=lambda row: -row["percent"])
    return rows[:3]
