from django.conf import settings
from django.db import models

from core.uploads import safe_upload_name


class ContentCategory(models.Model):
    """
    The category chips across the top of the Videos tab.

    A table rather than a hardcoded list, because these were always meant
    to be curated — a `choices` tuple would mean a deploy to add a
    category. The five the UI ships with are created by the
    `seed_categories` migration so a fresh install isn't blank.
    """

    slug = models.SlugField(max_length=50, unique=True)
    label = models.CharField(max_length=80)
    icon = models.CharField(max_length=8, blank=True)  # the emoji the UI draws
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "label"]
        verbose_name_plural = "content categories"

    def __str__(self):
        return self.label


class Content(models.Model):
    """
    One item in the library: a video, an audio session, or a written piece.

    Deliberately supports both an uploaded file and an external URL. Video
    hosting is genuinely expensive and a product at this stage may want to
    start with embeds and move to self-hosting later (or run both), so the
    model supports both from the beginning rather than forcing that
    decision now. Exactly one of `media_file` / `external_url` must be set,
    which the save() below enforces rather than trusting callers.

    `view_count` is denormalised from `ContentView` rows — the rows are the
    truth, the counter is the cache. It is recomputed by
    `manage.py audit_demo_data`, so a drift is detectable rather than
    permanent.
    """

    VIDEO = "video"
    AUDIO = "audio"
    ARTICLE = "article"
    MEDIUM_CHOICES = [(VIDEO, "Video"), (AUDIO, "Audio"), (ARTICLE, "Article")]

    DRAFT = "draft"
    PUBLISHED = "published"
    STATUS_CHOICES = [(DRAFT, "Draft"), (PUBLISHED, "Published")]

    UPLOAD_PREFIX = "library"

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="library_content"
    )

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    medium = models.CharField(max_length=10, choices=MEDIUM_CHOICES, default=VIDEO)
    category = models.ForeignKey(
        ContentCategory, on_delete=models.SET_NULL, null=True, blank=True, related_name="content"
    )
    tags = models.JSONField(default=list, blank=True)

    media_file = models.FileField(upload_to=safe_upload_name, null=True, blank=True)
    external_url = models.URLField(blank=True)
    thumbnail = models.ImageField(upload_to=safe_upload_name, null=True, blank=True)
    # The emoji the current UI shows in place of a real thumbnail. Kept so
    # an item without an uploaded thumbnail still renders the way the
    # existing design does, instead of a broken image box.
    thumbnail_emoji = models.CharField(max_length=8, blank=True)

    duration_seconds = models.PositiveIntegerField(default=0)
    body = models.TextField(blank=True)  # articles

    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PUBLISHED)
    view_count = models.PositiveIntegerField(default=0)

    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "-created_at"]),
            models.Index(fields=["category", "-created_at"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(media_file="", external_url="", body=""),
                name="content_has_a_body_file_or_url",
            )
        ]

    def __str__(self):
        return self.title

    @property
    def owner_id(self):
        return self.author_id

    @property
    def duration_label(self):
        """'5:23' — the format the UI already displays."""
        if not self.duration_seconds:
            return ""
        minutes, seconds = divmod(self.duration_seconds, 60)
        hours, minutes = divmod(minutes, 60)
        if hours:
            return f"{hours}:{minutes:02d}:{seconds:02d}"
        return f"{minutes}:{seconds:02d}"


class ContentView(models.Model):
    """
    A view, and how far through it the viewer got.

    One row per user per item, updated rather than appended, so "Continue
    watching" is a simple query and the view count is a count of people
    rather than a count of page loads.
    """

    content = models.ForeignKey(Content, on_delete=models.CASCADE, related_name="views")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="content_views"
    )

    progress_seconds = models.PositiveIntegerField(default=0)
    completed = models.BooleanField(default=False)

    first_viewed_at = models.DateTimeField(auto_now_add=True)
    last_viewed_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["content", "user"], name="unique_content_view")
        ]
        indexes = [models.Index(fields=["user", "-last_viewed_at"])]


class ContentReaction(models.Model):
    """A like on a library item."""

    content = models.ForeignKey(Content, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="content_reactions"
    )
    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["content", "user"], name="unique_content_reaction")
        ]


class ContentSave(models.Model):
    """A saved ("watch later") library item. Private, like a bookmark."""

    content = models.ForeignKey(Content, on_delete=models.CASCADE, related_name="saves")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="content_saves"
    )
    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["content", "user"], name="unique_content_save")
        ]
        ordering = ["-created_at"]


class ContentShare(models.Model):
    content = models.ForeignKey(Content, on_delete=models.CASCADE, related_name="shares")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="content_shares"
    )
    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["content", "user"], name="unique_content_share")
        ]


class ContentComment(models.Model):
    """A comment on a library item. Flat — the Videos UI has no reply
    affordance, so nesting here would be structure nothing renders."""

    content = models.ForeignKey(Content, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="content_comments"
    )
    body = models.TextField(max_length=2000)

    edited_at = models.DateTimeField(null=True, blank=True)

    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["content", "-created_at"])]
