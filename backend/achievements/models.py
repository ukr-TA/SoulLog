from django.conf import settings
from django.db import models


class Badge(models.Model):
    """
    One thing SoulLog celebrates.

    A table rather than a hardcoded list, because the set of things worth
    celebrating is a product decision that will change, and changing it
    shouldn't need a deploy. The starter set ships as a data migration.

    Each badge is a rule plus a threshold: `metric` names a quantity the
    app already computes about a user, and `threshold` is the value at
    which it's earned. That keeps awarding data-driven — adding "500
    entries" is a row, not code — and it means no badge can exist that
    isn't backed by something real. See `services.METRICS` for the
    metrics a badge may name.
    """

    CURRENT_STREAK = "current_streak"
    BEST_STREAK = "best_streak"
    ENTRIES = "entries"
    MOOD_CHECKINS = "mood_checkins"
    CONNECTIONS = "connections"
    POSTS = "posts"
    REACTIONS_RECEIVED = "reactions_received"

    METRIC_CHOICES = [
        (CURRENT_STREAK, "Current streak (days)"),
        (BEST_STREAK, "Longest streak ever (days)"),
        (ENTRIES, "Journal entries written"),
        (MOOD_CHECKINS, "Mood check-ins logged"),
        (CONNECTIONS, "Accepted connections"),
        (POSTS, "Sanctuary posts shared"),
        (REACTIONS_RECEIVED, "Reactions received"),
    ]

    slug = models.SlugField(max_length=60, unique=True)
    name = models.CharField(max_length=80)
    description = models.CharField(max_length=200, blank=True)
    icon = models.CharField(max_length=8, blank=True)

    metric = models.CharField(max_length=30, choices=METRIC_CHOICES)
    threshold = models.PositiveIntegerField()

    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "threshold"]

    def __str__(self):
        return self.name


class UserBadge(models.Model):
    """
    A badge a specific person has actually earned, and when.

    `earned_at` is the whole point of this table. The profile screens used
    to print "Earned April 2024" underneath badges nobody had earned; now
    the date is a record of the moment the condition was first met, so it
    can be shown without inventing anything.

    A badge is never removed once earned. Breaking a 30-day streak doesn't
    un-write the thirty days you did — and taking a badge away from
    someone in a wellbeing app for missing a day would be a small cruelty
    for no benefit.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="badges"
    )
    badge = models.ForeignKey(Badge, on_delete=models.CASCADE, related_name="awards")

    # The value of the metric at the moment it was earned. Kept so the
    # badge can say "a 34-day streak" rather than only "30+".
    value_at_award = models.PositiveIntegerField(default=0)
    earned_at = models.DateTimeField(auto_now_add=True)

    is_demo = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "badge"], name="unique_user_badge")
        ]
        ordering = ["-earned_at"]
        indexes = [models.Index(fields=["user", "-earned_at"])]

    def __str__(self):
        return f"{self.user.username} earned {self.badge.slug}"
