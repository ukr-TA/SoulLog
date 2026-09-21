from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models


class NotificationKind:
    """
    The notification types the UI already renders an icon for, plus the
    ones the real backend can now genuinely produce.

    Kept as a class of constants rather than a bare list so that a typo in
    a `notify()` call fails at import time in the caller, not silently at
    runtime with an unrenderable notification.
    """

    LIKE = "like"
    COMMENT = "comment"
    REPLY = "reply"
    REACTION = "reaction"
    FOLLOW = "follow"
    CONNECTION_REQUEST = "connection_request"
    CONNECTION_ACCEPTED = "connection_accepted"
    MESSAGE = "message"
    MENTION = "mention"
    COMMUNITY = "community"
    SHARE = "share"
    INSIGHT = "insight"
    MILESTONE = "milestone"
    REMINDER = "reminder"

    CHOICES = [
        (LIKE, "Like"),
        (COMMENT, "Comment"),
        (REPLY, "Reply"),
        (REACTION, "Reaction"),
        (FOLLOW, "Follow"),
        (CONNECTION_REQUEST, "Connection request"),
        (CONNECTION_ACCEPTED, "Connection accepted"),
        (MESSAGE, "Message"),
        (MENTION, "Mention"),
        (COMMUNITY, "Community"),
        (SHARE, "Share"),
        (INSIGHT, "Insight"),
        (MILESTONE, "Milestone"),
        (REMINDER, "Reminder"),
    ]

    # Which filter tab in NotificationPage.tsx each kind belongs to. The tabs
    # were there before the backend was; this mapping is what makes their
    # counts real.
    CATEGORY = {
        LIKE: "engagement",
        COMMENT: "engagement",
        REPLY: "engagement",
        REACTION: "engagement",
        SHARE: "engagement",
        MENTION: "engagement",
        FOLLOW: "social",
        CONNECTION_REQUEST: "social",
        CONNECTION_ACCEPTED: "social",
        MESSAGE: "social",
        COMMUNITY: "community",
        INSIGHT: "insights",
        MILESTONE: "achievements",
        REMINDER: "achievements",
    }

    # Which UserSettings.notifications toggle governs each kind. A kind that
    # maps to None is always delivered (there is no toggle that turns off
    # "someone accepted your connection request").
    SETTING_KEY = {
        LIKE: "socialInteractions",
        COMMENT: "socialInteractions",
        REPLY: "socialInteractions",
        REACTION: "socialInteractions",
        SHARE: "socialInteractions",
        MENTION: "socialInteractions",
        FOLLOW: "socialInteractions",
        CONNECTION_REQUEST: "socialInteractions",
        MESSAGE: "socialInteractions",
        COMMUNITY: "socialInteractions",
        MILESTONE: "achievements",
        REMINDER: "journalReminder",
        INSIGHT: "weeklyDigest",
    }


class Notification(models.Model):
    """
    One stored notification for one recipient.

    Spec §89 asks for creation, storage and delivery to be separable so
    that push can be added later without a rewrite. That's why this model
    knows nothing about *how* it reaches anyone: `services.notify()`
    creates the row, `services.deliver()` pushes it over the open
    WebSocket, and adding an APNs/FCM sender later means adding a second
    function next to `deliver()` — not touching this model, and not
    touching any of the ~15 call sites that create notifications.

    `target` is a generic relation so a notification can point at a journal
    entry, a community post, a comment or a connection without this app
    importing any of them (and creating an import cycle).

    Deduplication: `dedupe_key` collapses repeat events. Ten people hearting
    the same entry should not be ten rows — see `services.notify()`.
    """

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="notifications_caused",
        help_text="The user who did the thing. Null for system notifications.",
    )

    kind = models.CharField(max_length=32, choices=NotificationKind.CHOICES)
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    # Free-text label for the thing acted on — an entry title, a circle name.
    target_label = models.CharField(max_length=200, blank=True)

    target_type = models.ForeignKey(
        ContentType, on_delete=models.CASCADE, null=True, blank=True
    )
    target_id = models.PositiveBigIntegerField(null=True, blank=True)
    target = GenericForeignKey("target_type", "target_id")

    # How many distinct actors this row represents, for "and 12 others".
    actor_count = models.PositiveIntegerField(default=1)
    dedupe_key = models.CharField(max_length=200, blank=True, db_index=True)

    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)

    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["recipient", "-updated_at"]),
            models.Index(fields=["recipient", "is_read"]),
        ]

    def __str__(self):
        return f"{self.kind} -> {self.recipient.username}"

    @property
    def category(self):
        return NotificationKind.CATEGORY.get(self.kind, "engagement")
