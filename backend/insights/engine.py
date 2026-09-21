"""
SoulLog's Insight Engine (spec §29-32).

Every analyzer here:
  - reads ONLY the requesting user's own real JournalEntry/MoodCheckIn data
  - returns nothing (an empty list) when there isn't enough data to say
    anything meaningful, rather than fabricating a pattern
  - reports a confidence level derived from actual sample size, never a
    made-up number
  - uses cautious, non-diagnostic language: "observed pattern", never a
    causal or clinical claim (spec §30 — SoulLog is not a diagnostic tool)

Architecture note (spec §32): each analyzer is a plain function
(user, now) -> list[dict], and InsightEngine.run() just calls each one
and concatenates results. This is deliberately not a class hierarchy —
there's no shared state or polymorphism needed yet, so a heavier OOP
design would be complexity without benefit (spec §115). Adding a new
analyzer later means adding one function and registering it in ANALYZERS.

Not yet persisted: insights are computed fresh on every request rather
than stored in an Insight/InsightEvidence table. For the current data
volumes this is fast and always up to date; if/when this needs caching
(spec §120's "architecture-ready" pattern), the natural extension point
is wrapping InsightEngine.run()'s result in a periodic background task
that writes to an Insight model, without changing any analyzer's
signature.

--- On the four categories that are still not here -------------------------

An early, fabricated version of this page showed six insight categories.
Four of them could not be honestly built:

  Sleep & Mood        SoulLog does not collect sleep data.
  Weather Impact      SoulLog does not collect location or weather data.

Those two remain absent. Adding them would mean either inventing numbers
or quietly starting to collect data a journalling app never told anyone it
would collect — and a wellness product that silently expands what it
records about you is exactly the thing this codebase has been careful not
to be. They are a product decision, not a missing function.

The other two turned out to be genuinely computable from data SoulLog
already has, and are implemented below:

  Weekend Reflection Depth   word counts, weekend vs weekday
  Stress Response Evolution  how stress-flagged check-ins trend over time
"""

import re
from collections import Counter, defaultdict
from datetime import timedelta

from django.utils import timezone


def _confidence_from_sample_size(n, low=5, moderate=15):
    if n < low:
        return "Low"
    if n < moderate:
        return "Moderate"
    return "High"


def mood_frequency_analyzer(user, now):
    """Which mood the user has logged most often recently, and how often."""
    from moods.models import MoodCheckIn

    window_start = now - timedelta(days=30)
    checkins = MoodCheckIn.objects.filter(owner=user, created_at__gte=window_start)
    total = checkins.count()

    if total < 3:
        return []

    counts = Counter(checkins.values_list("mood", flat=True))
    top_mood, top_count = counts.most_common(1)[0]
    percentage = round((top_count / total) * 100)

    return [{
        "category": "Mood Pattern",
        "text": (
            f"Observed pattern: '{top_mood}' was your most logged mood over the last 30 days, "
            f"appearing in {top_count} of your {total} check-ins ({percentage}%). "
            f"This reflects what you've recorded, not a diagnosis of your emotional state."
        ),
        "evidence": f"Generated from {total} mood check-ins in the last 30 days",
        "confidence": _confidence_from_sample_size(total),
    }]


def consistency_trend_analyzer(user, now):
    """Compares this week's active days (journal entry or mood check-in)
    against the prior week, to surface a genuine consistency trend."""
    from journal.models import JournalEntry
    from moods.models import MoodCheckIn

    def active_days_in_range(start, end):
        j_dates = set(
            JournalEntry.objects.filter(owner=user, is_deleted=False, created_at__gte=start, created_at__lt=end)
            .values_list("created_at__date", flat=True)
        )
        m_dates = set(
            MoodCheckIn.objects.filter(owner=user, created_at__gte=start, created_at__lt=end)
            .values_list("created_at__date", flat=True)
        )
        return len(j_dates | m_dates)

    this_week_start = now - timedelta(days=7)
    last_week_start = now - timedelta(days=14)

    this_week = active_days_in_range(this_week_start, now)
    last_week = active_days_in_range(last_week_start, this_week_start)

    # Need at least some activity across both windows to say anything
    # meaningful about a trend — otherwise this is silence, not a card.
    if this_week == 0 and last_week == 0:
        return []

    if this_week > last_week:
        direction = f"up from {last_week} the week before — a noticeable increase in consistency"
    elif this_week < last_week:
        direction = f"down from {last_week} the week before"
    else:
        direction = f"holding steady at {last_week} the week before"

    total_sample = this_week + last_week
    return [{
        "category": "Consistency Pattern",
        "text": (
            f"Observed pattern: you've been active (journaling or checking in) on {this_week} "
            f"of the last 7 days, {direction}. This may be worth reflecting on."
        ),
        "evidence": f"Based on the last 14 days of activity ({total_sample} active days total)",
        "confidence": _confidence_from_sample_size(total_sample, low=2, moderate=6),
    }]


def time_of_day_analyzer(user, now):
    """
    When this person tends to write.

    Uses the entry's local hour (Django's TIME_ZONE), bucketed into the
    four parts of day the UI talks in. Reported only when one bucket
    actually stands out — an even spread across the day is not a pattern,
    and saying "you write in the morning (26%)" about a flat distribution
    would be technically true and practically a lie.
    """
    from journal.models import JournalEntry

    window_start = now - timedelta(days=90)
    entries = JournalEntry.objects.filter(
        owner=user, is_deleted=False, created_at__gte=window_start
    ).values_list("created_at", flat=True)

    stamps = list(entries)
    total = len(stamps)
    if total < 5:
        return []

    buckets = Counter()
    for stamp in stamps:
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
    share = count / total

    # A quarter of entries in one of four buckets is chance. 40% is a lean.
    if share < 0.40:
        return []

    return [{
        "category": "Time Pattern",
        "text": (
            f"Observed pattern: {round(share * 100)}% of your entries in the last 90 days were "
            f"written in the {label} ({count} of {total}). Noticing when you tend to reflect "
            f"can be as useful as noticing what you write."
        ),
        "evidence": f"Based on the timestamps of {total} entries over 90 days",
        "confidence": _confidence_from_sample_size(total),
    }]


def weekend_depth_analyzer(user, now):
    """
    Weekend Reflection Depth — one of the four originally-fabricated
    categories, and one that turned out to be genuinely computable.

    Compares median words per entry on weekends against weekdays. Median,
    not mean: one unusually long entry should not create a "pattern".
    Requires at least three entries on each side, and a difference of at
    least 25%, before it says anything.
    """
    from journal.models import JournalEntry

    window_start = now - timedelta(days=90)
    rows = JournalEntry.objects.filter(
        owner=user, is_deleted=False, created_at__gte=window_start, word_count__gt=0
    ).values_list("created_at", "word_count")

    weekend, weekday = [], []
    for stamp, words in rows:
        local = timezone.localtime(stamp)
        (weekend if local.weekday() >= 5 else weekday).append(words)

    if len(weekend) < 3 or len(weekday) < 3:
        return []

    def median(values):
        values = sorted(values)
        middle = len(values) // 2
        if len(values) % 2:
            return values[middle]
        return (values[middle - 1] + values[middle]) / 2

    weekend_median = median(weekend)
    weekday_median = median(weekday)
    if weekday_median == 0:
        return []

    ratio = weekend_median / weekday_median
    if 0.75 <= ratio <= 1.25:
        return []

    if ratio > 1:
        phrasing = (
            f"your weekend entries run about {round((ratio - 1) * 100)}% longer than your "
            f"weekday ones ({round(weekend_median)} words vs {round(weekday_median)})"
        )
    else:
        phrasing = (
            f"your weekday entries run about {round((1 - ratio) * 100)}% longer than your "
            f"weekend ones ({round(weekday_median)} words vs {round(weekend_median)})"
        )

    sample = len(weekend) + len(weekday)
    return [{
        "category": "Weekend Reflection Depth",
        "text": (
            f"Observed pattern: {phrasing}. Length isn't quality — this is about when you "
            f"tend to have room to write, not when you reflect better."
        ),
        "evidence": f"Median word counts across {sample} entries in the last 90 days",
        "confidence": _confidence_from_sample_size(sample, low=8, moderate=20),
    }]


# Moods SoulLog's own vocabulary treats as difficult. Used only to count
# how often the *user themselves* selected them — never to infer a state
# they didn't record.
STRESS_MOODS = {"Stressed", "Anxious", "Frustrated", "Angry", "Sad", "Lonely"}


def stress_evolution_analyzer(user, now):
    """
    Stress Response Evolution — the other originally-fabricated category
    that real data supports.

    Compares the share of check-ins marked with a difficult mood in the
    last 30 days against the 30 days before that. Needs 8 check-ins in
    each window, because a share computed from three data points is noise
    wearing a percentage sign.

    The wording here is the most carefully chosen in this module: it
    reports a change in what the user logged, explicitly disclaims cause,
    and never suggests anything is wrong with them.
    """
    from moods.models import MoodCheckIn

    recent_start = now - timedelta(days=30)
    prior_start = now - timedelta(days=60)

    def stressed_share(start, end):
        rows = list(
            MoodCheckIn.objects.filter(
                owner=user, created_at__gte=start, created_at__lt=end
            ).values_list("mood", flat=True)
        )
        if len(rows) < 8:
            return None, len(rows)
        difficult = sum(1 for mood in rows if mood in STRESS_MOODS)
        return difficult / len(rows), len(rows)

    recent_share, recent_n = stressed_share(recent_start, now)
    prior_share, prior_n = stressed_share(prior_start, recent_start)

    if recent_share is None or prior_share is None:
        return []

    delta = recent_share - prior_share
    if abs(delta) < 0.15:
        return []

    if delta < 0:
        movement = (
            f"down from {round(prior_share * 100)}% to {round(recent_share * 100)}% of your "
            f"check-ins"
        )
    else:
        movement = (
            f"up from {round(prior_share * 100)}% to {round(recent_share * 100)}% of your "
            f"check-ins"
        )

    sample = recent_n + prior_n
    return [{
        "category": "Stress Response Evolution",
        "text": (
            f"Observed pattern: check-ins where you chose a difficult mood are {movement}, "
            f"comparing the last 30 days with the 30 before. This describes what you logged; "
            f"it doesn't explain why, and it isn't an assessment of how you're doing."
        ),
        "evidence": f"Comparing {recent_n} recent and {prior_n} earlier mood check-ins",
        "confidence": _confidence_from_sample_size(sample, low=16, moderate=40),
    }]


# Words that carry no signal about what someone was writing about. Kept
# explicit rather than pulled from a library so it can be read and argued
# with — a stopword list is a small editorial decision, not a constant.
#
# The number words at the end were added after seeing the output: an early
# version of this page offered "Three (mentioned 3 times)" and "Four
# (mentioned 3 times)" as a person's common themes, which is not wrong
# exactly — they had written those words — but it is useless, and a
# wellness app telling someone their recurring theme is "four" reads as
# broken. Counting words is a blunt method and it needs its blunt edges
# filed off.
STOPWORDS = {
    "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "at",
    "back", "be", "because", "been", "before", "being", "but", "by", "can", "could", "did", "do",
    "does", "doing", "don", "down", "during", "each", "even", "feel", "feeling", "felt", "few",
    "for", "from", "get", "getting", "go", "going", "got", "had", "has", "have", "having", "he",
    "her", "here", "hers", "him", "his", "how", "i", "if", "in", "into", "is", "it", "its", "just",
    "keep", "know", "like", "little", "lot", "made", "make", "many", "me", "might", "more", "most",
    "much", "must", "my", "need", "never", "new", "no", "not", "now", "of", "off", "on", "once",
    "one", "only", "or", "other", "our", "out", "over", "own", "really", "same", "see", "she",
    "should", "so", "some", "still", "such", "take", "than", "that", "the", "their", "them",
    "then", "there", "these", "they", "thing", "things", "think", "this", "those", "though",
    "through", "time", "to", "today", "too", "up", "us", "use", "very", "want", "was", "way",
    "we", "well", "went", "were", "what", "when", "where", "which", "while", "who", "why",
    "will", "with", "would", "you", "your", "yours",
    # Number words and units of time: real words, no meaning as a theme.
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "twenty", "thirty", "forty", "fifty", "sixty",
    "seventy", "eighty", "ninety", "hundred", "thousand",
    "first", "second", "third", "last", "next", "another",
    "day", "days", "week", "weeks", "month", "months", "year", "years",
    "hour", "hours", "minute", "minutes", "morning", "evening", "night", "tonight",
    "yesterday", "tomorrow", "always", "already", "maybe", "probably", "actually",
    "something", "nothing", "anything", "everything", "someone", "everyone", "nobody",
    "bit", "kind", "sort", "part", "place", "thing",
    # Remaining high-frequency function words that survived the first pass.
    "rather", "around", "toward", "towards", "almost", "enough", "instead",
    "since", "until", "without", "within", "along", "across", "behind",
    "between", "against", "during", "above", "below", "under", "again",
    "ever", "every", "else", "quite", "somewhat", "perhaps", "either",
    "neither", "whether", "yet", "far", "near", "long", "short", "good",
    "bad", "better", "worse", "best", "worst", "right", "wrong", "sure",
    "able", "away", "back", "later", "soon", "still", "whole", "half",
}

# Letters and internal hyphens only. Apostrophes are deliberately excluded
# rather than allowed: with them, "I've", "I'd" and "didn't" become tokens
# and immediately dominate the list, because contractions are among the
# most common words in anyone's writing and among the least meaningful as
# a theme. This was visible in the real output before it was fixed.
WORD_PATTERN = re.compile(r"[a-z][a-z-]{3,}")


def extract_themes(texts, limit=6, minimum_mentions=3):
    """
    Word-frequency theme extraction.

    This is exactly what it looks like: counting meaningful words, not
    semantic topic modelling. It is named honestly for that reason, and the
    UI labels the result "mentioned N times" rather than claiming to have
    understood the writing. A user's own recurring vocabulary is genuinely
    informative; pretending it is more than that would not be.

    Counts documents, not occurrences — a word repeated eight times in one
    entry is one entry's worth of evidence, not eight.

    Three filters, each added because of something the real output
    produced rather than in anticipation: contractions are excluded by the
    pattern, number and time words by the stopword list, and words shorter
    than four letters by the pattern's length bound. A blunt method needs
    its blunt edges filed off, and the filing is visible here rather than
    hidden behind a library.
    """
    document_counts = Counter()
    for text in texts:
        words = set()
        for match in WORD_PATTERN.finditer((text or "").lower()):
            word = match.group().strip("-")
            if len(word) >= 4 and word not in STOPWORDS:
                words.add(word)
        document_counts.update(words)

    return [
        {"theme": word, "mentions": count}
        for word, count in document_counts.most_common(limit * 3)
        if count >= minimum_mentions
    ][:limit]


def theme_analyzer(user, now):
    """A card naming the user's most recurrent subject, when one exists."""
    from journal.models import JournalEntry

    window_start = now - timedelta(days=90)
    texts = list(
        JournalEntry.objects.filter(
            owner=user, is_deleted=False, created_at__gte=window_start
        ).values_list("content", flat=True)
    )
    if len(texts) < 5:
        return []

    themes = extract_themes(texts, limit=3, minimum_mentions=3)
    if not themes:
        return []

    top = themes[0]
    others = ", ".join(t["theme"] for t in themes[1:])
    tail = f" Others that recur: {others}." if others else ""

    return [{
        "category": "Recurring Themes",
        "text": (
            f"Observed pattern: '{top['theme']}' appears in {top['mentions']} of your last "
            f"{len(texts)} entries — more often than any other word you use.{tail} "
            f"This is word frequency in your own writing, not an interpretation of it."
        ),
        "evidence": f"Word frequency across {len(texts)} entries in the last 90 days",
        "confidence": _confidence_from_sample_size(len(texts)),
    }]


ANALYZERS = [
    mood_frequency_analyzer,
    consistency_trend_analyzer,
    time_of_day_analyzer,
    weekend_depth_analyzer,
    stress_evolution_analyzer,
    theme_analyzer,
]


def run_insight_engine(user):
    now = timezone.now()
    results = []
    for analyzer in ANALYZERS:
        results.extend(analyzer(user, now))
    return results


# --- Chart data -------------------------------------------------------------
# These back the three panels on the Insights page that were hardcoded
# arrays in the component. They are not "insights" (no observation, no
# confidence) — they are the user's own numbers, so they live here beside
# the analyzers but are served from their own endpoints.

# The emoji the UI draws per mood. Mapping lives here rather than in the
# component so the backend can return complete rows and the chart doesn't
# have to know SoulLog's mood vocabulary.
MOOD_EMOJI = {
    "Happy": "😊", "Sad": "😢", "Angry": "😠", "Excited": "🤩", "Anxious": "😰",
    "Calm": "😌", "Frustrated": "😤", "Content": "🙂", "Lonely": "😔",
    "Grateful": "🙏", "Stressed": "😣", "Hopeful": "🌱",
}


def mood_distribution(user, days=30):
    """
    Real mood counts for the chart, most frequent first.

    `height` is a percentage of the tallest bar, so the component keeps
    doing exactly what it already did with the fake data — multiply by a
    pixel factor — and no styling changes.
    """
    from moods.models import MoodCheckIn

    window_start = timezone.now() - timedelta(days=days)
    counts = Counter(
        MoodCheckIn.objects.filter(owner=user, created_at__gte=window_start).values_list(
            "mood", flat=True
        )
    )
    if not counts:
        return []

    tallest = max(counts.values())
    return [
        {
            "emoji": MOOD_EMOJI.get(mood, "•"),
            "label": mood,
            "value": count,
            "height": round(count / tallest * 100),
        }
        for mood, count in counts.most_common(6)
    ]


def time_patterns(user, days=30):
    """
    The four lines under "Time Patterns", each computed rather than written.

    Returns only the lines there is data to support. An account with three
    entries gets one line, not four padded ones.
    """
    from journal.models import JournalEntry
    from moods.models import MoodCheckIn

    now = timezone.now()
    window_start = now - timedelta(days=days)

    entries = list(
        JournalEntry.objects.filter(
            owner=user, is_deleted=False, created_at__gte=window_start
        ).values_list("created_at", "word_count", "mood")
    )
    lines = []

    if len(entries) >= 3:
        hours = Counter(timezone.localtime(stamp).hour for stamp, _w, _m in entries)
        # Report the busiest two-hour window rather than a single hour:
        # "7-9 PM" is how people think about when they write.
        best_start, best_total = max(
            ((h, hours.get(h, 0) + hours.get((h + 1) % 24, 0)) for h in range(24)),
            key=lambda pair: pair[1],
        )
        share = round(best_total / len(entries) * 100)
        if share >= 20:
            lines.append(
                f"Most active: {_format_hour(best_start)}-{_format_hour((best_start + 2) % 24)} "
                f"({share}% of entries)"
            )

    moods_by_part = defaultdict(Counter)
    for stamp, _words, mood in entries:
        if mood:
            moods_by_part[_part_of_day(timezone.localtime(stamp).hour)][mood] += 1
    positive = {"Happy", "Calm", "Content", "Grateful", "Hopeful", "Excited"}
    if moods_by_part:
        best_part = max(
            moods_by_part.items(),
            key=lambda row: sum(c for m, c in row[1].items() if m in positive) / max(sum(row[1].values()), 1),
        )
        if sum(best_part[1].values()) >= 3:
            lines.append(f"Best mood: {best_part[0].capitalize()} entries")

    weekend_words = [w for stamp, w, _m in entries if timezone.localtime(stamp).weekday() >= 5 and w]
    weekday_words = [w for stamp, w, _m in entries if timezone.localtime(stamp).weekday() < 5 and w]
    if len(weekend_words) >= 2 and len(weekday_words) >= 2:
        weekend_avg = sum(weekend_words) / len(weekend_words)
        weekday_avg = sum(weekday_words) / len(weekday_words)
        if abs(weekend_avg - weekday_avg) / max(weekday_avg, 1) >= 0.15:
            lines.append(
                "Longest entries: " + ("Weekends" if weekend_avg > weekday_avg else "Weekdays")
            )

    active_days = set(
        d for d in JournalEntry.objects.filter(
            owner=user, is_deleted=False, created_at__gte=window_start
        ).values_list("created_at__date", flat=True)
    ) | set(
        MoodCheckIn.objects.filter(owner=user, created_at__gte=window_start).values_list(
            "created_at__date", flat=True
        )
    )
    if active_days:
        weeks = max(days / 7, 1)
        lines.append(f"Consistency: {len(active_days) / weeks:.1f} days/week average")

    return lines


def _part_of_day(hour):
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 22:
        return "evening"
    return "late night"


def _format_hour(hour):
    suffix = "AM" if hour < 12 else "PM"
    display = hour % 12 or 12
    return f"{display} {suffix}"


def common_themes(user, days=90, limit=4):
    """The "Common Themes" panel — real word frequency from real entries."""
    from journal.models import JournalEntry

    window_start = timezone.now() - timedelta(days=days)
    texts = list(
        JournalEntry.objects.filter(
            owner=user, is_deleted=False, created_at__gte=window_start
        ).values_list("content", flat=True)
    )
    if len(texts) < 3:
        return []

    return [
        f"{row['theme'].capitalize()} (mentioned {row['mentions']} times)"
        for row in extract_themes(texts, limit=limit, minimum_mentions=2)
    ]
