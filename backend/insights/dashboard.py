"""
The numbers behind the Dashboard home screen.

That screen was the most visible fake in the app. It greeted every user as
"Alex", awarded everyone a 23-day streak and 62% of a daily goal, drew a
"Past 14 Days" grid whose colours came from `Math.random()`, plotted a
mood trend from a hardcoded array, and offered a "Weekly Insight" about
outdoor walks that nobody had ever logged. This module computes each of
those from the user's own journal entries and mood check-ins, in one
request, so the screen can draw all of it from one response.

Two conventions, the same as the Insight Engine next door:

  An empty day is empty. A day with no check-in is reported as `None`
  and drawn as a blank square — never smoothed over, never filled in.

  Tips are only offered when the data supports them. The hero line under
  the quote used to say "Your reflections are deeper in the mornings" to
  everyone; it now appears only when one part of the day genuinely
  dominates this person's writing, and is absent otherwise.
"""

from collections import Counter, defaultdict
from datetime import timedelta

from django.utils import timezone

# A rough pleasantness score per mood, 1 (hardest) to 5 (best), used only
# to colour the 14-day grid and size the weekly trend bars. It is not
# shown as a number anywhere: it is a way to draw a feeling, not a
# measurement of one.
MOOD_SCORE = {
    "Happy": 5, "Excited": 5, "Grateful": 5,
    "Hopeful": 4, "Content": 4, "Calm": 4,
    "Lonely": 2, "Anxious": 2, "Stressed": 2, "Frustrated": 2,
    "Sad": 1, "Angry": 1,
}

# Defaults for users who have never set a goal. Deliberately modest: one
# entry a day and five a week is a habit, not a quota.
DEFAULT_DAILY_GOAL = 1
DEFAULT_WEEKLY_GOAL = 5


def _goal(settings_group, key, default, upper):
    try:
        value = int((settings_group or {}).get(key, default))
    except (TypeError, ValueError):
        return default
    return max(1, min(value, upper))


def _time_tip(entry_stamps):
    """
    A one-line nudge about when this person writes, or None.

    Same threshold as the Insight Engine's time-of-day analyzer: at least
    five entries, and one part of the day holding 40% or more of them.
    Below that, "you write in the mornings" would be chance dressed up as
    advice.
    """
    if len(entry_stamps) < 5:
        return None

    buckets = Counter()
    for stamp in entry_stamps:
        hour = timezone.localtime(stamp).hour
        if 5 <= hour < 12:
            buckets["morning"] += 1
        elif 12 <= hour < 17:
            buckets["afternoon"] += 1
        elif 17 <= hour < 22:
            buckets["evening"] += 1
        else:
            buckets["late night"] += 1

    label, count = buckets.most_common(1)[0]
    share = count / len(entry_stamps)
    if share < 0.40:
        return None

    return (
        f"Most of your entries ({round(share * 100)}%) are written in the {label} "
        f"— that may be when reflecting comes easiest to you."
    )


def send_weekly_digest(user, now=None):
    """
    The "Weekly Digest" notification: a one-line summary of last week.

    Settings has offered this since the start and nothing ever sent one.
    There is no scheduler in this deployment, so it is sent lazily: the
    first time someone opens their dashboard in a new week, they get last
    week's summary — once, thanks to the dedupe key, and only if there was
    something to summarise. `notify()` applies the user's own switches, so
    turning "Weekly Digest" off stops it.
    """
    from journal.models import JournalEntry
    from moods.models import MoodCheckIn
    from notifications.models import NotificationKind
    from notifications.services import notify

    today = timezone.localtime(now).date() if now else timezone.localtime().date()
    this_monday = today - timedelta(days=today.weekday())
    last_monday = this_monday - timedelta(days=7)

    entries = JournalEntry.objects.filter(
        owner=user, is_deleted=False,
        created_at__date__gte=last_monday, created_at__date__lt=this_monday,
    ).count()
    moods = list(MoodCheckIn.objects.filter(
        owner=user, created_at__date__gte=last_monday, created_at__date__lt=this_monday,
    ).values_list("mood", flat=True))
    if not entries and not moods:
        return None

    parts = []
    if entries:
        parts.append(f"{entries} journal entr{'y' if entries == 1 else 'ies'}")
    if moods:
        parts.append(f"{len(moods)} mood check-in{'' if len(moods) == 1 else 's'}")
    body = "Last week: " + " and ".join(parts) + "."
    if moods:
        top, count = Counter(moods).most_common(1)[0]
        body += f" You felt {top.lower()} most often."

    year, week, _ = last_monday.isocalendar()
    return notify(
        recipient=user,
        actor=None,
        kind=NotificationKind.INSIGHT,
        title="Your week in SoulLog",
        body=body,
        dedupe_key=f"digest:{year}-W{week:02d}",
    )


def dashboard_summary(user):
    from achievements.services import current_streak
    from journal.models import JournalEntry
    from moods.models import MoodCheckIn

    from .engine import run_insight_engine

    now = timezone.localtime()
    today = now.date()
    start_14 = today - timedelta(days=13)
    week_start = today - timedelta(days=today.weekday())  # Monday

    entries = JournalEntry.objects.filter(owner=user, is_deleted=False)
    checkins = MoodCheckIn.objects.filter(owner=user)

    # --- goals ------------------------------------------------------------
    journaling = getattr(getattr(user, "app_settings", None), "journaling", {}) or {}
    daily_goal = _goal(journaling, "dailyGoal", DEFAULT_DAILY_GOAL, 10)
    weekly_goal = _goal(journaling, "weeklyGoal", DEFAULT_WEEKLY_GOAL, 50)

    recent_entry_stamps = list(
        entries.filter(created_at__date__gte=week_start - timedelta(days=90))
        .values_list("created_at", flat=True)
    )
    today_entries = sum(1 for s in recent_entry_stamps if timezone.localtime(s).date() == today)
    week_entries = sum(
        1 for s in recent_entry_stamps if timezone.localtime(s).date() >= week_start
    )

    # --- moods by day -----------------------------------------------------
    # Check-ins are the primary signal; a journal entry's own mood counts
    # too, so someone who writes but never taps the mood picker still sees
    # their days.
    by_day = defaultdict(list)
    for mood, stamp in checkins.filter(
        created_at__date__gte=min(start_14, week_start)
    ).values_list("mood", "created_at"):
        by_day[timezone.localtime(stamp).date()].append((stamp, mood))
    for mood, stamp in entries.filter(
        created_at__date__gte=min(start_14, week_start)
    ).exclude(mood="").values_list("mood", "created_at"):
        by_day[timezone.localtime(stamp).date()].append((stamp, mood))

    def day_row(day):
        moods = sorted(by_day.get(day, []))
        if not moods:
            return {"date": day.isoformat(), "mood": None, "score": None, "count": 0}
        scores = [MOOD_SCORE.get(m, 3) for _, m in moods]
        return {
            "date": day.isoformat(),
            # The day's latest mood is what the tooltip names; the colour
            # uses the day's average so one hard moment doesn't recolour a
            # good day, or the reverse.
            "mood": moods[-1][1],
            "score": round(sum(scores) / len(scores), 1),
            "count": len(moods),
        }

    last_14 = [day_row(start_14 + timedelta(days=i)) for i in range(14)]
    week = [day_row(week_start + timedelta(days=i)) for i in range(7)]

    # --- today's check-in ---------------------------------------------------
    latest_today = (
        checkins.filter(created_at__date=today).order_by("-created_at").first()
    )

    # Last week's digest, if it hasn't been sent yet. Never allowed to
    # break the dashboard.
    try:
        send_weekly_digest(user)
    except Exception:  # noqa: BLE001
        pass

    # --- one real insight ---------------------------------------------------
    insights = run_insight_engine(user)
    highlight = None
    if insights:
        first = insights[0]
        highlight = {"category": first.get("category"), "text": first.get("text")}

    return {
        "firstName": ((user.fullname or user.username).split() or [user.username])[0],
        "streakDays": current_streak(user),
        "today": {
            "entries": today_entries,
            "goal": daily_goal,
            "checkin": (
                {
                    "mood": latest_today.mood,
                    "note": latest_today.description,
                    "createdAt": latest_today.created_at.isoformat(),
                }
                if latest_today
                else None
            ),
        },
        "week": {
            "entries": week_entries,
            "goal": weekly_goal,
            "days": week,
        },
        "last14": last_14,
        "timeTip": _time_tip(recent_entry_stamps),
        # Settings → Social → "Daily Inspiration" (stored as inspirationFeed).
        "showQuote": bool(
            (getattr(getattr(user, "app_settings", None), "social", None) or {}).get("inspirationFeed", True)
        ),
        "highlight": highlight,
    }
