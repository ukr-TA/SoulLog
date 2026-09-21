from django.conf import settings
from django.db import models

from core.uploads import safe_upload_name

# Preserved from the existing frontend's mood-check-in options
# (MoodCheckin.tsx's `moods` array) so the backend's controlled vocabulary
# matches exactly what the UI already offers — see spec §27. This was
# corrected once already: an earlier version of this list used a
# different, invented 9-mood set that didn't match the real UI, which
# would have made every real mood check-in fail validation.
MOOD_CHOICES = [
    ("Happy", "Happy"),
    ("Sad", "Sad"),
    ("Angry", "Angry"),
    ("Excited", "Excited"),
    ("Anxious", "Anxious"),
    ("Calm", "Calm"),
    ("Frustrated", "Frustrated"),
    ("Content", "Content"),
    ("Lonely", "Lonely"),
    ("Grateful", "Grateful"),
    ("Stressed", "Stressed"),
    ("Hopeful", "Hopeful"),
]

ENTRY_TYPE_CHOICES = [
    ("text", "Text"),
    ("photo", "Photo"),
    ("voice", "Voice"),
]

VISIBILITY_CHOICES = [
    ("private", "Private"),
    ("connections", "Connections"),
    ("community", "Community"),
]


class JournalEntry(models.Model):
    """
    A single journal entry.

    Privacy note (spec §21 — critical security requirement): visibility is
    enforced in the view/queryset layer, never assumed from the frontend.
    A private entry must be unreachable by anyone except its owner even if
    they guess its id.
    """

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="journal_entries"
    )

    title = models.CharField(max_length=200, blank=True)
    content = models.TextField(blank=True)
    entry_type = models.CharField(max_length=10, choices=ENTRY_TYPE_CHOICES, default="text")

    mood = models.CharField(max_length=20, choices=MOOD_CHOICES, blank=True)
    tags = models.JSONField(default=list, blank=True)
    visibility = models.CharField(max_length=20, choices=VISIBILITY_CHOICES, default="private")

    prompt_used = models.CharField(max_length=300, blank=True)
    word_count = models.PositiveIntegerField(default=0)

    # --- Share settings (spec §23) -----------------------------------------
    # The share modal in CreateJournal.tsx has always offered these four
    # controls. Until now `visibility` and `tags` were the only two that
    # reached the server; these four were collected and dropped. They are
    # real columns rather than a JSON blob because each one is *enforced*
    # somewhere — allow_comments gates the comment endpoints, identity
    # changes what the serializer returns as the author — and enforced
    # behaviour deserves a queryable column.
    IDENTITY_CHOICES = [("username", "Show my username"), ("anonymous", "Post anonymously")]

    identity = models.CharField(max_length=10, choices=IDENTITY_CHOICES, default="username")
    include_mood = models.BooleanField(default=True)
    include_date = models.BooleanField(default=True)
    allow_comments = models.BooleanField(default=True)

    is_deleted = models.BooleanField(default=False)  # soft delete (spec §24)

    is_demo = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["owner", "-created_at"]),
            models.Index(fields=["visibility"]),
        ]

    def __str__(self):
        return f"{self.owner.username}: {self.title or self.content[:30]}"

    def save(self, *args, **kwargs):
        self.word_count = len((self.content or "").split())
        super().save(*args, **kwargs)


class JournalMedia(models.Model):
    """
    A photo or voice note attached to an entry.

    This model existed before anything could create a row in it — the
    Voice Note and Photo Memory buttons were dead. It now goes through
    `core.uploads` like every other upload: validated, size-limited, stored
    under a random name, and partitioned by owner so a journal photo is
    never one guessable path away from a stranger.

    `duration_seconds` is only meaningful for voice notes and is supplied
    by the recorder; it is display metadata, so a wrong value is cosmetic
    rather than a correctness problem.
    """

    UPLOAD_PREFIX = "journal"

    entry = models.ForeignKey(JournalEntry, on_delete=models.CASCADE, related_name="media")
    file = models.FileField(upload_to=safe_upload_name)
    kind = models.CharField(max_length=10, blank=True)  # image | audio
    mime_type = models.CharField(max_length=100, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    duration_seconds = models.PositiveIntegerField(default=0)
    caption = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    @property
    def owner_id(self):
        return self.entry.owner_id


class JournalComment(models.Model):
    """
    A comment on a journal entry, with one level of replies (matching the
    UI's existing two-tier comment/reply structure — spec §25 warns against
    unlimited comment trees, so replies-to-replies aren't supported).
    """

    entry = models.ForeignKey(JournalEntry, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="journal_comments")
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE, related_name="replies"
    )
    content = models.TextField(max_length=2000)

    # Null until the comment is edited. A nullable timestamp rather than a
    # boolean because "when" is worth knowing and costs the same to store,
    # and because the UI shows "edited" only when there is a time to show.
    edited_at = models.DateTimeField(null=True, blank=True)

    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["entry", "created_at"])]

    def __str__(self):
        return f"{self.author.username} on entry {self.entry_id}"


class JournalCommentReaction(models.Model):
    """A single user's heart on a comment. One reaction per user per comment."""

    comment = models.ForeignKey(JournalComment, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ["comment", "user"]


class JournalEntryReaction(models.Model):
    """
    A single user's heart on a *shared* journal entry. One per user per
    entry, same shape as `JournalCommentReaction`.

    Added late, to back something the UI was already drawing: the Journal
    card has always rendered a heart with a count next to the comment
    count on shared entries, and that count read a field the API never
    returned — so it displayed 0 forever. The choice was to remove the
    heart or make it real; since a shared entry is exactly the thing
    other people are meant to respond to, and comments on one are already
    supported, making it real is the smaller change to the design.

    Who may react is not decided here — the view applies the same
    visibility check that governs commenting, so an entry you cannot see
    is an entry you cannot heart.
    """

    entry = models.ForeignKey(JournalEntry, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ["entry", "user"]
        indexes = [models.Index(fields=["entry", "created_at"])]

    def __str__(self):
        return f"{self.user.username} ♥ entry {self.entry_id}"
