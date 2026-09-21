from django.conf import settings
from django.db import models


class SearchQuery(models.Model):
    """
    A search someone actually ran.

    This is what makes two things in `CommunitySearch.tsx` real. "Recent
    searches" was a hardcoded array of three strings; it is now this user's
    own last searches. "Trending" was another hardcoded array; it is now
    the most-run searches across the platform in a recent window.

    Privacy, because search history is sensitive: a row is scoped to its
    owner and only ever returned to them. Trending is computed as an
    aggregate over a minimum number of *distinct users* — a term one person
    searched ten times never becomes "trending", which would expose an
    individual's searching through a supposedly platform-wide list.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="searches"
    )
    term = models.CharField(max_length=120)
    scope = models.CharField(max_length=20, default="all")
    result_count = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["term", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.user.username}: {self.term}"


class Topic(models.Model):
    """
    A named topic people can follow — the curated counterpart to free-text
    tags on posts.

    Kept minimal on purpose. A full circles/groups system (membership
    roles, moderation, per-group privacy) is a product decision nobody has
    made yet, and building the machinery for it before the decision would
    be building the wrong thing carefully. A topic is a label you can
    follow so your feed can prefer it; that much is clearly useful now.
    """

    slug = models.SlugField(max_length=60, unique=True)
    label = models.CharField(max_length=80)
    description = models.CharField(max_length=300, blank=True)
    icon = models.CharField(max_length=8, blank=True)

    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["label"]

    def __str__(self):
        return self.label


class TopicFollow(models.Model):
    topic = models.ForeignKey(Topic, on_delete=models.CASCADE, related_name="followers")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="followed_topics"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["topic", "user"], name="unique_topic_follow")
        ]
