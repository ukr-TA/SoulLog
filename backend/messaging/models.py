from django.conf import settings
from django.db import models

from core.uploads import safe_upload_name


class Conversation(models.Model):
    """
    A conversation between two or more people.

    Modelled as N participants from the start even though Whispers' UI is
    one-to-one today. That isn't speculative generality — it is the one
    place where retrofitting is genuinely expensive: a two-FK
    `user_a`/`user_b` table cannot become a group chat without rewriting
    every query, every index and every message-read record in the system.
    A participant table costs one extra join now and nothing later.

    `is_direct` marks the one-to-one case so that "open my conversation
    with Sarah" can find the existing thread instead of starting a second
    one every time.
    """

    is_direct = models.BooleanField(default=True)
    title = models.CharField(max_length=140, blank=True)  # group conversations only

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="conversations_started",
    )

    # Denormalised so the conversation list can be ordered without joining
    # and aggregating the whole message table on every page load.
    last_message_at = models.DateTimeField(null=True, blank=True, db_index=True)

    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-last_message_at", "-created_at"]

    def __str__(self):
        return f"Conversation<{self.id}>"

    def other_participant(self, user):
        """For a direct conversation: the person who isn't `user`."""
        participant = (
            self.participants.exclude(user=user).select_related("user", "user__profile").first()
        )
        return participant.user if participant else None


class ConversationParticipant(models.Model):
    """
    One person's membership of one conversation, and their own read state.

    Read state lives here rather than on Message because it is per-person:
    in a group conversation the same message is read by one participant and
    unread by another. `last_read_at` is a single timestamp instead of a
    per-message read table — unread counts are then one indexed COUNT
    rather than a row per message per person, which is the difference
    between a cheap conversation list and an expensive one.
    """

    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="participants"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="conversation_memberships"
    )

    last_read_at = models.DateTimeField(null=True, blank=True)
    is_muted = models.BooleanField(default=False)
    # A participant who leaves keeps their row (so their sent messages still
    # have a valid author context) but stops receiving anything.
    left_at = models.DateTimeField(null=True, blank=True)

    # Per-person list housekeeping, like any chat app:
    #  - pinned_at: pinned to the top of *your* list (newest pin first)
    #  - is_archived: moved out of your main list into Archived
    #  - cleared_at: "Delete chat" — everything up to this moment is gone
    #    for you (the other person keeps their copy); the chat leaves your
    #    list until someone writes in it again.
    pinned_at = models.DateTimeField(null=True, blank=True)
    is_archived = models.BooleanField(default=False)
    cleared_at = models.DateTimeField(null=True, blank=True)

    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["conversation", "user"], name="unique_conversation_participant"
            )
        ]
        indexes = [models.Index(fields=["user", "-joined_at"])]

    def __str__(self):
        return f"{self.user.username} in conversation {self.conversation_id}"


class Message(models.Model):
    """
    One message.

    Soft-deleted, like journal entries: `is_deleted` blanks the body for
    everyone but keeps the row, so the conversation doesn't silently
    renumber or lose its shape for the other person.
    """

    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="messages"
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="messages_sent"
    )

    body = models.TextField(max_length=5000, blank=True)

    is_deleted = models.BooleanField(default=False)
    edited_at = models.DateTimeField(null=True, blank=True)

    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["conversation", "created_at"])]

    def __str__(self):
        return f"msg {self.id} from {self.sender.username}"


class MessageAttachment(models.Model):
    """
    A file attached to a message.

    Goes through `core.uploads` like every other upload in SoulLog, so it
    is size-limited, content-verified and stored under a random name — and
    moves to S3 with the rest of the media on a config change alone.
    """

    UPLOAD_PREFIX = "messages"

    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to=safe_upload_name)
    kind = models.CharField(max_length=10)  # image | audio | video
    mime_type = models.CharField(max_length=100, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    original_name = models.CharField(max_length=255, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def owner_id(self):
        # What `core.uploads.safe_upload_name` partitions the stored path by.
        return self.message.sender_id
