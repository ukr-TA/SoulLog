from django.conf import settings
from django.db import models

from core.uploads import safe_upload_name


class SanctuaryPost(models.Model):
    """
    A post in the Sanctuary — the shared feed inside Community.

    A note on why there is one post model and not two. The deferred-work
    inventory listed "Sanctuary" and "Community" as separate subsystems
    needing separate models (`SanctuaryPost…` and `CommunityPost…`). Reading
    the actual frontend, Community is not a second feed: `Community.tsx` is
    a tab container whose three tabs are Sanctuary (this feed), Souls
    (connections) and Videos (the content library). Building a second,
    near-identical post table to satisfy the inventory would have meant two
    places to fix every future privacy bug, for no user-visible difference.
    So: one post model here, and the `community` app does discovery across
    posts, people and content instead of owning a duplicate feed.

    Visibility reuses the journal vocabulary (`public` / `connections`),
    because a user who has learned what "connections only" means on a
    journal entry should not have to learn a second meaning here.
    """

    PUBLIC = "public"
    CONNECTIONS = "connections"
    VISIBILITY_CHOICES = [(PUBLIC, "Everyone"), (CONNECTIONS, "Connections only")]

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sanctuary_posts"
    )

    content = models.TextField(max_length=5000)
    tags = models.JSONField(default=list, blank=True)
    visibility = models.CharField(max_length=20, choices=VISIBILITY_CHOICES, default=PUBLIC)

    # Set when a post was created by sharing a journal entry the user had
    # already marked community-visible. Keeping the link means the post
    # disappears if the entry is later made private again — see
    # `sanctuary.views.FeedView`.
    source_entry = models.ForeignKey(
        "journal.JournalEntry",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="sanctuary_posts",
    )

    share_count = models.PositiveIntegerField(default=0)

    is_deleted = models.BooleanField(default=False)
    is_demo = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["-created_at"]),
            models.Index(fields=["author", "-created_at"]),
            models.Index(fields=["visibility", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.author.username}: {self.content[:40]}"


class PostMedia(models.Model):
    """An image or video attached to a post. Uploaded and validated through
    `core.uploads` like every other file in SoulLog."""

    UPLOAD_PREFIX = "sanctuary"

    post = models.ForeignKey(SanctuaryPost, on_delete=models.CASCADE, related_name="media")
    file = models.FileField(upload_to=safe_upload_name)
    kind = models.CharField(max_length=10)  # image | video
    mime_type = models.CharField(max_length=100, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    alt_text = models.CharField(max_length=300, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    @property
    def owner_id(self):
        return self.post.author_id


class PostComment(models.Model):
    """
    A comment on a post, with one level of replies — the same two-tier
    structure as journal comments, and the same reason: unlimited nesting
    is a UI and moderation problem nobody actually wants (spec §25).
    """

    post = models.ForeignKey(SanctuaryPost, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sanctuary_comments"
    )
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.CASCADE, related_name="replies"
    )
    content = models.TextField(max_length=2000)

    edited_at = models.DateTimeField(null=True, blank=True)

    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["post", "created_at"])]


class PostReaction(models.Model):
    """
    A like on a post or on a comment.

    One table for both rather than two near-identical ones: the reaction
    itself is the same concept and the same uniqueness rule, and a single
    table means "what has this user liked?" is one query. Exactly one of
    `post`/`comment` is set, enforced by a database constraint rather than
    by hoping the application layer gets it right.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sanctuary_reactions"
    )
    post = models.ForeignKey(
        SanctuaryPost, on_delete=models.CASCADE, null=True, blank=True, related_name="reactions"
    )
    comment = models.ForeignKey(
        PostComment, on_delete=models.CASCADE, null=True, blank=True, related_name="reactions"
    )

    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "post"],
                condition=models.Q(post__isnull=False),
                name="unique_post_reaction",
            ),
            models.UniqueConstraint(
                fields=["user", "comment"],
                condition=models.Q(comment__isnull=False),
                name="unique_comment_reaction",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(post__isnull=False, comment__isnull=True)
                    | models.Q(post__isnull=True, comment__isnull=False)
                ),
                name="reaction_targets_exactly_one",
            ),
        ]


class PostBookmark(models.Model):
    """A saved post. Private to the person who saved it — a bookmark is not
    a public signal and is never surfaced to the author."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sanctuary_bookmarks"
    )
    post = models.ForeignKey(SanctuaryPost, on_delete=models.CASCADE, related_name="bookmarks")

    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "post"], name="unique_post_bookmark")
        ]
        ordering = ["-created_at"]


class PostShare(models.Model):
    """
    A record of someone sharing a post.

    Stored rather than kept as a bare counter so the count can be audited,
    a share can be undone, and — the reason that actually matters — the
    number shown in the UI is a count of real rows instead of an integer
    that anything could increment.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sanctuary_shares"
    )
    post = models.ForeignKey(SanctuaryPost, on_delete=models.CASCADE, related_name="shares")

    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "post"], name="unique_post_share")
        ]
